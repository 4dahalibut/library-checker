import Database from "better-sqlite3";
import { dirname, join } from "path";
import { seedExercises, seedSequences } from "./seed.js";
import type {
  Exercise,
  Ladder,
  LadderState,
  PlanItem,
  ResolvedSequence,
  ResolvedSequenceItem,
  Rung,
  Sequence,
  Side,
  Unit,
} from "./types.js";

// Default to the same directory as the library DB so it lands on the same volume
const dbPath =
  process.env.WORKOUT_DATABASE_PATH ||
  join(dirname(process.env.DATABASE_PATH || "data/library.db"), "workout.db");
export const workoutDb = new Database(dbPath);

workoutDb.pragma("journal_mode = WAL");
workoutDb.pragma("foreign_keys = ON");

// Baseline schema (user_version 0). Later changes go in MIGRATIONS below, never here.
workoutDb.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_id TEXT NOT NULL,
    sequence_name TEXT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    cue TEXT NOT NULL DEFAULT '',
    target_sets INTEGER,
    target_reps INTEGER,
    target_seconds INTEGER,
    target_weight REAL,
    sets_done INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    weight REAL,
    seconds INTEGER,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS session_items_session ON session_items(session_id, position);
`);

// Each migration runs once, in order, inside a transaction, and bumps user_version.
// Append new ones; never reorder or change what a shipped migration does. Migrations
// use their own SQL, not the helpers below, since those follow the latest schema.
const SLUG_CHECK = (col: string) =>
  `CHECK (${col} GLOB '[a-z0-9]*' AND ${col} NOT GLOB '*[^a-z0-9-]*' AND length(${col}) <= 64)`;
const DATE_CHECK = (col: string) => `CHECK (${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;

const MIGRATIONS: (() => void)[] = [
  // 1: exercises and sequences live in the database instead of the code
  () => {
    workoutDb.exec(`
      CREATE TABLE exercises (
        id TEXT PRIMARY KEY ${SLUG_CHECK("id")},
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        weighted INTEGER NOT NULL DEFAULT 0 CHECK (weighted IN (0, 1)),
        timed INTEGER NOT NULL DEFAULT 0 CHECK (timed IN (0, 1)),
        to_failure INTEGER NOT NULL DEFAULT 0 CHECK (to_failure IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sequences (
        id TEXT PRIMARY KEY ${SLUG_CHECK("id")},
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        position INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sequence_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
        sets INTEGER CHECK (sets IS NULL OR sets > 0),
        reps INTEGER CHECK (reps IS NULL OR reps > 0),
        seconds INTEGER CHECK (seconds IS NULL OR seconds > 0),
        weight REAL CHECK (weight IS NULL OR weight >= 0),
        cue TEXT NOT NULL DEFAULT '',
        UNIQUE (sequence_id, position)
      );
      CREATE INDEX sequence_items_exercise ON sequence_items(exercise_id);

      -- Reps reached per set, for to-failure exercises
      CREATE TABLE session_sets (
        session_item_id INTEGER NOT NULL REFERENCES session_items(id) ON DELETE CASCADE,
        set_number INTEGER NOT NULL CHECK (set_number > 0),
        reps INTEGER NOT NULL CHECK (reps >= 0),
        PRIMARY KEY (session_item_id, set_number)
      );

      -- Sessions snapshot the exercise and how it was logged, like the targets
      ALTER TABLE session_items ADD COLUMN exercise_id TEXT;
      ALTER TABLE session_items ADD COLUMN weighted INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_items ADD COLUMN timed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_items ADD COLUMN to_failure INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX session_items_exercise ON session_items(exercise_id);
    `);

    const insertExercise = workoutDb.prepare(
      "INSERT INTO exercises (id, name, weighted, timed, to_failure) VALUES (?, ?, ?, ?, ?)"
    );
    for (const e of seedExercises) {
      insertExercise.run(e.id, e.name, e.weighted ? 1 : 0, e.timed ? 1 : 0, e.toFailure ? 1 : 0);
    }
    const insertSequence = workoutDb.prepare("INSERT INTO sequences (id, name, position) VALUES (?, ?, ?)");
    const insertItem = workoutDb.prepare(
      `INSERT INTO sequence_items (sequence_id, position, exercise_id, sets, reps, seconds, weight, cue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    seedSequences.forEach((seq, position) => {
      insertSequence.run(seq.id, seq.name, position);
      seq.items.forEach((item, i) => {
        insertItem.run(
          seq.id,
          i,
          item.exerciseId,
          item.sets ?? null,
          item.reps ?? null,
          item.seconds ?? null,
          item.weight ?? null,
          item.cue ?? ""
        );
      });
    });

    // Link sessions logged before this migration to their exercises by name
    workoutDb.exec(`
      UPDATE session_items SET
        exercise_id = (SELECT e.id FROM exercises e WHERE lower(e.name) = lower(session_items.name)),
        weighted = COALESCE((SELECT e.weighted FROM exercises e WHERE lower(e.name) = lower(session_items.name)), 0),
        timed = COALESCE((SELECT e.timed FROM exercises e WHERE lower(e.name) = lower(session_items.name)), 0),
        to_failure = COALESCE((SELECT e.to_failure FROM exercises e WHERE lower(e.name) = lower(session_items.name)), 0)
      WHERE exercise_id IS NULL;
    `);
  },

  // 2: progression ladders, a weekly schedule, and an explicit Finish on sessions
  () => {
    workoutDb.exec(`
      -- Only finished sessions count toward the week
      ALTER TABLE sessions ADD COLUMN finished_at TEXT;
      CREATE INDEX sessions_date ON sessions(date);

      CREATE TABLE ladders (
        id TEXT PRIMARY KEY ${SLUG_CHECK("id")},
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        extra_side TEXT CHECK (extra_side IN ('left', 'right')),
        current_rung INTEGER NOT NULL DEFAULT 1 CHECK (current_rung >= 1),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ladder_rungs (
        ladder_id TEXT NOT NULL REFERENCES ladders(id) ON DELETE CASCADE,
        rung INTEGER NOT NULL CHECK (rung >= 1),
        exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
        sets INTEGER CHECK (sets IS NULL OR sets > 0),
        reps INTEGER CHECK (reps IS NULL OR reps > 0),
        reps_max INTEGER CHECK (reps_max IS NULL OR (reps IS NOT NULL AND reps_max > reps)),
        seconds INTEGER CHECK (seconds IS NULL OR seconds > 0),
        seconds_max INTEGER CHECK (seconds_max IS NULL OR (seconds IS NOT NULL AND seconds_max > seconds)),
        unit TEXT NOT NULL DEFAULT 'reps' CHECK (unit IN ('reps', 'breaths', 'steps', 'm')),
        per_side INTEGER NOT NULL DEFAULT 0 CHECK (per_side IN (0, 1)),
        weight REAL CHECK (weight IS NULL OR weight >= 0),
        cue TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (ladder_id, rung)
      );
      CREATE INDEX ladder_rungs_exercise ON ladder_rungs(exercise_id);

      -- Every rung change, for looking back at progress
      CREATE TABLE ladder_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ladder_id TEXT NOT NULL REFERENCES ladders(id) ON DELETE CASCADE,
        from_rung INTEGER,
        to_rung INTEGER NOT NULL,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Each existing slot becomes a one-rung ladder named after its exercise
      -- (if an exercise sat in two slots, the first slot's targets win)
      INSERT INTO ladders (id, name)
        SELECT DISTINCT e.id, e.name FROM sequence_items si JOIN exercises e ON e.id = si.exercise_id;
      INSERT INTO ladder_rungs (ladder_id, rung, exercise_id, sets, reps, seconds, weight, cue)
        SELECT exercise_id, 1, exercise_id, sets, reps, seconds, weight, cue FROM sequence_items si
        WHERE si.id = (SELECT MIN(s2.id) FROM sequence_items s2 WHERE s2.exercise_id = si.exercise_id);

      -- Sequence slots now point at ladders; targets live on the rungs
      CREATE TABLE sequence_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        ladder_id TEXT NOT NULL REFERENCES ladders(id) ON DELETE RESTRICT,
        label TEXT NOT NULL DEFAULT '',
        UNIQUE (sequence_id, position)
      );
      INSERT INTO sequence_items_new (id, sequence_id, position, ladder_id)
        SELECT id, sequence_id, position, exercise_id FROM sequence_items;
      DROP TABLE sequence_items;
      ALTER TABLE sequence_items_new RENAME TO sequence_items;
      CREATE INDEX sequence_items_ladder ON sequence_items(ladder_id);

      -- Sessions snapshot the ladder rung and the full target too
      ALTER TABLE session_items ADD COLUMN ladder_id TEXT;
      ALTER TABLE session_items ADD COLUMN rung INTEGER;
      ALTER TABLE session_items ADD COLUMN label TEXT NOT NULL DEFAULT '';
      ALTER TABLE session_items ADD COLUMN target_reps_max INTEGER;
      ALTER TABLE session_items ADD COLUMN target_seconds_max INTEGER;
      ALTER TABLE session_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'reps';
      ALTER TABLE session_items ADD COLUMN per_side INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_items ADD COLUMN extra_side TEXT;
      UPDATE session_items SET ladder_id = exercise_id, rung = 1 WHERE exercise_id IS NOT NULL;

      -- The weekly schedule: what each weekday holds (Monday = 0), in order
      CREATE TABLE schedule_slots (
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        position INTEGER NOT NULL CHECK (position >= 0),
        sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
        optional INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
        PRIMARY KEY (weekday, position)
      );

      -- A date listed here was changed by hand and uses its own items instead of
      -- the schedule (no items means a rest day)
      CREATE TABLE day_plans (
        date TEXT PRIMARY KEY ${DATE_CHECK("date")}
      );
      CREATE TABLE day_plan_items (
        date TEXT NOT NULL REFERENCES day_plans(date) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
        optional INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
        PRIMARY KEY (date, position)
      );

      -- Busy-week floor, e.g. 3 Main and 4 Daily Reset
      CREATE TABLE weekly_minimums (
        sequence_id TEXT PRIMARY KEY REFERENCES sequences(id) ON DELETE CASCADE,
        per_week INTEGER NOT NULL CHECK (per_week BETWEEN 1 AND 14)
      );
    `);
  },

  // 3: how to do each exercise: a description and an ordered list of form cues
  () => {
    workoutDb.exec(`
      ALTER TABLE exercises ADD COLUMN description TEXT NOT NULL DEFAULT '';
      CREATE TABLE exercise_cues (
        exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        text TEXT NOT NULL CHECK (length(trim(text)) > 0),
        PRIMARY KEY (exercise_id, position)
      );
    `);
  },

  // 4: a word picked at Finish to describe how the session went
  () => {
    workoutDb.exec(`
      ALTER TABLE sessions ADD COLUMN word TEXT CHECK (word IS NULL OR length(word) BETWEEN 1 AND 40);
    `);
  },

  // 5: self-ratings out of 5 picked at Finish
  () => {
    workoutDb.exec(`
      ALTER TABLE sessions ADD COLUMN effort INTEGER CHECK (effort IS NULL OR effort BETWEEN 1 AND 5);
      ALTER TABLE sessions ADD COLUMN conscientiousness INTEGER
        CHECK (conscientiousness IS NULL OR conscientiousness BETWEEN 1 AND 5);
    `);
  },

  // 6: pain reports by body part, "hit the top of the range" for automatic promotion,
  //    and rest between sets per sequence
  () => {
    workoutDb.exec(`
      CREATE TABLE pain_areas (
        id TEXT PRIMARY KEY ${SLUG_CHECK("id")},
        name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 40),
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pain_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area_id TEXT NOT NULL REFERENCES pain_areas(id) ON DELETE RESTRICT,
        date TEXT NOT NULL ${DATE_CHECK("date")},
        intensity INTEGER CHECK (intensity IS NULL OR intensity BETWEEN 1 AND 5),
        note TEXT NOT NULL DEFAULT '',
        reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX pain_reports_date ON pain_reports(date);

      INSERT INTO pain_areas (id, name, position) VALUES
        ('left-ankle', 'Left ankle', 0),
        ('right-knee', 'Right knee', 1),
        ('left-hip', 'Left hip', 2),
        ('low-back', 'Low back', 3),
        ('right-finger', 'Right finger', 4),
        ('left-shoulder', 'Left shoulder', 5),
        ('right-plantar-fascia', 'Right plantar fascia', 6);

      -- Ticked when the top of a ranged target was reached with good position
      ALTER TABLE session_items ADD COLUMN hit_top INTEGER NOT NULL DEFAULT 0 CHECK (hit_top IN (0, 1));

      -- Seconds of rest after a set (0 = no rest timer)
      ALTER TABLE sequences ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 0 CHECK (rest_seconds BETWEEN 0 AND 600);
      UPDATE sequences SET rest_seconds = 75 WHERE id = 'main';
      UPDATE sequences SET rest_seconds = 60 WHERE id = 'foundation';
      UPDATE sequences SET rest_seconds = 30 WHERE id = 'mobility';
    `);
  },
];

function migrate(): void {
  const current = workoutDb.pragma("user_version", { simple: true }) as number;
  MIGRATIONS.slice(current).forEach((migration, i) => {
    workoutDb.transaction(() => {
      migration();
      workoutDb.pragma(`user_version = ${current + i + 1}`);
    })();
  });
}

// --- Exercises ---

interface ExerciseRow {
  id: string;
  name: string;
  weighted: number;
  timed: number;
  to_failure: number;
}

function toExercise(r: ExerciseRow): Exercise {
  return { id: r.id, name: r.name, weighted: !!r.weighted, timed: !!r.timed, toFailure: !!r.to_failure };
}

export interface ExerciseGuide {
  description: string;
  cues: string[];
}

export function listExercises(): (Exercise & ExerciseGuide)[] {
  const rows = workoutDb
    .prepare("SELECT id, name, weighted, timed, to_failure, description FROM exercises ORDER BY name")
    .all() as (ExerciseRow & { description: string })[];
  const guides = getGuides(rows.map((r) => r.id));
  return rows.map((r) => ({ ...toExercise(r), ...guides.get(r.id)! }));
}

/** Descriptions and cues for these exercises (empty for unknown ids) */
export function getGuides(ids: string[]): Map<string, ExerciseGuide> {
  const guides = new Map<string, ExerciseGuide>(ids.map((id) => [id, { description: "", cues: [] }]));
  if (!ids.length) return guides;
  const marks = ids.map(() => "?").join(", ");
  for (const r of workoutDb
    .prepare(`SELECT id, description FROM exercises WHERE id IN (${marks})`)
    .all(...ids) as { id: string; description: string }[]) {
    guides.get(r.id)!.description = r.description;
  }
  for (const r of workoutDb
    .prepare(`SELECT exercise_id, text FROM exercise_cues WHERE exercise_id IN (${marks}) ORDER BY exercise_id, position`)
    .all(...ids) as { exercise_id: string; text: string }[]) {
    guides.get(r.exercise_id)!.cues.push(r.text);
  }
  return guides;
}

/** Replace an exercise's description and cues */
export function saveGuide(id: string, guide: ExerciseGuide): void {
  workoutDb.transaction(() => {
    workoutDb
      .prepare("UPDATE exercises SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(guide.description, id);
    workoutDb.prepare("DELETE FROM exercise_cues WHERE exercise_id = ?").run(id);
    const insert = workoutDb.prepare("INSERT INTO exercise_cues (exercise_id, position, text) VALUES (?, ?, ?)");
    guide.cues.forEach((text, i) => insert.run(id, i, text));
  })();
}

/** Insert or replace every field of an exercise */
export function saveExercise(ex: Exercise): void {
  workoutDb
    .prepare(
      `INSERT INTO exercises (id, name, weighted, timed, to_failure)
       VALUES (@id, @name, @weighted, @timed, @to_failure)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, weighted = excluded.weighted,
         timed = excluded.timed, to_failure = excluded.to_failure, updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      id: ex.id,
      name: ex.name,
      weighted: ex.weighted ? 1 : 0,
      timed: ex.timed ? 1 : 0,
      to_failure: ex.toFailure ? 1 : 0,
    });
}

function missing(table: "exercises" | "ladders" | "sequences", ids: string[]): string[] {
  const known = new Set(
    (workoutDb.prepare(`SELECT id FROM ${table}`).all() as { id: string }[]).map((r) => r.id)
  );
  return [...new Set(ids)].filter((id) => !known.has(id));
}

export const unknownExercises = (ids: string[]) => missing("exercises", ids);
export const unknownLadders = (ids: string[]) => missing("ladders", ids);
export const unknownSequences = (ids: string[]) => missing("sequences", ids);

// --- Ladders ---

interface RungRow {
  ladder_id: string;
  rung: number;
  exercise_id: string;
  sets: number | null;
  reps: number | null;
  reps_max: number | null;
  seconds: number | null;
  seconds_max: number | null;
  unit: Unit;
  per_side: number;
  weight: number | null;
  cue: string;
}

function toRung(r: RungRow): Rung {
  const rung: Rung = { exerciseId: r.exercise_id };
  if (r.sets !== null) rung.sets = r.sets;
  if (r.reps !== null) rung.reps = r.reps;
  if (r.reps_max !== null) rung.repsMax = r.reps_max;
  if (r.seconds !== null) rung.seconds = r.seconds;
  if (r.seconds_max !== null) rung.secondsMax = r.seconds_max;
  if (r.unit !== "reps") rung.unit = r.unit;
  if (r.per_side) rung.perSide = true;
  if (r.weight !== null) rung.weight = r.weight;
  if (r.cue) rung.cue = r.cue;
  return rung;
}

export function listLadders(): LadderState[] {
  const ladders = workoutDb
    .prepare("SELECT id, name, extra_side, current_rung FROM ladders ORDER BY name")
    .all() as { id: string; name: string; extra_side: Side | null; current_rung: number }[];
  const rungs = workoutDb.prepare("SELECT * FROM ladder_rungs ORDER BY ladder_id, rung").all() as RungRow[];
  return ladders.map((l) => {
    const ladder: LadderState = {
      id: l.id,
      name: l.name,
      currentRung: l.current_rung,
      rungs: rungs.filter((r) => r.ladder_id === l.id).map(toRung),
    };
    if (l.extra_side) ladder.extraSide = l.extra_side;
    return ladder;
  });
}

export function getLadder(id: string): LadderState | null {
  return listLadders().find((l) => l.id === id) ?? null;
}

/**
 * Insert or replace a ladder's name, side bias and rungs. Keeps the current rung,
 * pulled down if the ladder got shorter.
 */
export function saveLadder(ladder: Ladder): void {
  workoutDb.transaction(() => {
    workoutDb
      .prepare(
        `INSERT INTO ladders (id, name, extra_side) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, extra_side = excluded.extra_side,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(ladder.id, ladder.name, ladder.extraSide ?? null);
    workoutDb.prepare("DELETE FROM ladder_rungs WHERE ladder_id = ?").run(ladder.id);
    const insert = workoutDb.prepare(
      `INSERT INTO ladder_rungs
         (ladder_id, rung, exercise_id, sets, reps, reps_max, seconds, seconds_max, unit, per_side, weight, cue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    ladder.rungs.forEach((r, i) => {
      insert.run(
        ladder.id,
        i + 1,
        r.exerciseId,
        r.sets ?? null,
        r.reps ?? null,
        r.repsMax ?? null,
        r.seconds ?? null,
        r.secondsMax ?? null,
        r.unit ?? "reps",
        r.perSide ? 1 : 0,
        r.weight ?? null,
        r.cue ?? ""
      );
    });
    const { current_rung } = workoutDb
      .prepare("SELECT current_rung FROM ladders WHERE id = ?")
      .get(ladder.id) as { current_rung: number };
    if (current_rung > ladder.rungs.length) setLadderRung(ladder.id, ladder.rungs.length);
  })();
}

/** Moves a ladder to a rung and logs the change. Returns false if out of range. */
export function setLadderRung(id: string, rung: number): boolean {
  return workoutDb.transaction(() => {
    const ladder = workoutDb.prepare("SELECT current_rung FROM ladders WHERE id = ?").get(id) as
      | { current_rung: number }
      | undefined;
    const { n } = workoutDb
      .prepare("SELECT COUNT(*) AS n FROM ladder_rungs WHERE ladder_id = ?")
      .get(id) as { n: number };
    if (!ladder || rung < 1 || rung > n) return false;
    if (ladder.current_rung === rung) return true;
    workoutDb
      .prepare("UPDATE ladders SET current_rung = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(rung, id);
    workoutDb
      .prepare("INSERT INTO ladder_changes (ladder_id, from_rung, to_rung) VALUES (?, ?, ?)")
      .run(id, ladder.current_rung, rung);
    return true;
  })();
}

// --- Sequences ---

/** Active (not archived) sequences in home-screen order, each slot at its ladder's current rung */
export function listSequences(): ResolvedSequence[] {
  const seqs = workoutDb
    .prepare("SELECT id, name, rest_seconds AS restSeconds FROM sequences WHERE archived = 0 ORDER BY position, id")
    .all() as { id: string; name: string; restSeconds: number }[];
  const slots = workoutDb
    .prepare(
      `SELECT si.sequence_id, si.label, l.id AS ladder_id, l.name AS ladder_name, l.extra_side,
              l.current_rung, (SELECT COUNT(*) FROM ladder_rungs c WHERE c.ladder_id = l.id) AS rung_count,
              r.rung, r.exercise_id, r.sets, r.reps, r.reps_max, r.seconds, r.seconds_max, r.unit,
              r.per_side, r.weight, r.cue, e.name, e.weighted, e.timed, e.to_failure
       FROM sequence_items si
       JOIN ladders l ON l.id = si.ladder_id
       JOIN ladder_rungs r ON r.ladder_id = l.id AND r.rung = l.current_rung
       JOIN exercises e ON e.id = r.exercise_id
       ORDER BY si.sequence_id, si.position`
    )
    .all() as (RungRow &
    Omit<ExerciseRow, "id"> & {
      sequence_id: string;
      label: string;
      ladder_name: string;
      extra_side: Side | null;
      current_rung: number;
      rung_count: number;
    })[];
  return seqs.map((seq) => ({
    ...seq,
    items: slots
      .filter((s) => s.sequence_id === seq.id)
      .map((s): ResolvedSequenceItem => {
        const item: ResolvedSequenceItem = {
          ladderId: s.ladder_id,
          ladderName: s.ladder_name,
          rung: s.current_rung,
          rungCount: s.rung_count,
          name: s.name,
          weighted: !!s.weighted,
          timed: !!s.timed,
          toFailure: !!s.to_failure,
          ...toRung(s),
        };
        if (s.label) item.label = s.label;
        if (s.extra_side) item.extraSide = s.extra_side;
        return item;
      }),
  }));
}

export function getSequence(id: string): ResolvedSequence | null {
  return listSequences().find((s) => s.id === id) ?? null;
}

/**
 * Insert or replace a sequence and its whole slot list, and un-archive it.
 * New sequences go last on the home screen unless a position is given.
 */
export function saveSequence(seq: Sequence, position?: number): void {
  workoutDb.transaction(() => {
    const existing = workoutDb.prepare("SELECT position FROM sequences WHERE id = ?").get(seq.id) as
      | { position: number }
      | undefined;
    const next = (
      workoutDb.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sequences").get() as { p: number }
    ).p;
    workoutDb
      .prepare(
        `INSERT INTO sequences (id, name, position) VALUES (@id, @name, @position)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position,
           archived = 0, updated_at = CURRENT_TIMESTAMP`
      )
      .run({ id: seq.id, name: seq.name, position: position ?? existing?.position ?? next });
    workoutDb.prepare("DELETE FROM sequence_items WHERE sequence_id = ?").run(seq.id);
    const insert = workoutDb.prepare(
      "INSERT INTO sequence_items (sequence_id, position, ladder_id, label) VALUES (?, ?, ?, ?)"
    );
    seq.items.forEach((item, i) => insert.run(seq.id, i, item.ladderId, item.label ?? ""));
  })();
}

/** Hides a sequence; past sessions keep pointing at it and saving it again restores it */
export function archiveSequence(id: string): boolean {
  return (
    workoutDb
      .prepare("UPDATE sequences SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id).changes > 0
  );
}

// --- Schedule ---

export interface Schedule {
  /** Monday first */
  days: PlanItem[][];
  minimums: { sequenceId: string; perWeek: number }[];
}

function toPlanItems(rows: { sequence_id: string; optional: number }[]): PlanItem[] {
  return rows.map((r) => (r.optional ? { sequenceId: r.sequence_id, optional: true } : { sequenceId: r.sequence_id }));
}

export function getSchedule(): Schedule {
  const slots = workoutDb
    .prepare("SELECT weekday, sequence_id, optional FROM schedule_slots ORDER BY weekday, position")
    .all() as { weekday: number; sequence_id: string; optional: number }[];
  const minimums = workoutDb
    .prepare("SELECT sequence_id AS sequenceId, per_week AS perWeek FROM weekly_minimums ORDER BY sequence_id")
    .all() as Schedule["minimums"];
  return {
    days: Array.from({ length: 7 }, (_, d) => toPlanItems(slots.filter((s) => s.weekday === d))),
    minimums,
  };
}

export function saveSchedule(schedule: Schedule): void {
  workoutDb.transaction(() => {
    workoutDb.exec("DELETE FROM schedule_slots; DELETE FROM weekly_minimums;");
    const slot = workoutDb.prepare(
      "INSERT INTO schedule_slots (weekday, position, sequence_id, optional) VALUES (?, ?, ?, ?)"
    );
    schedule.days.forEach((items, d) =>
      items.forEach((item, i) => slot.run(d, i, item.sequenceId, item.optional ? 1 : 0))
    );
    const min = workoutDb.prepare("INSERT INTO weekly_minimums (sequence_id, per_week) VALUES (?, ?)");
    schedule.minimums.forEach((m) => min.run(m.sequenceId, m.perWeek));
  })();
}

/** Dates in the range that were changed by hand, with their items */
export function getDayPlans(from: string, to: string): Map<string, PlanItem[]> {
  const dates = workoutDb
    .prepare("SELECT date FROM day_plans WHERE date BETWEEN ? AND ?")
    .all(from, to) as { date: string }[];
  const items = workoutDb
    .prepare(
      `SELECT date, sequence_id, optional FROM day_plan_items WHERE date BETWEEN ? AND ?
       ORDER BY date, position`
    )
    .all(from, to) as { date: string; sequence_id: string; optional: number }[];
  return new Map(dates.map(({ date }) => [date, toPlanItems(items.filter((i) => i.date === date))]));
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** What a date holds: its hand-made plan, or the schedule for its weekday */
export function effectivePlan(date: string): PlanItem[] {
  return getDayPlans(date, date).get(date) ?? getSchedule().days[weekdayOf(date)];
}

export function setDayPlan(date: string, items: PlanItem[]): void {
  workoutDb.transaction(() => {
    workoutDb.prepare("INSERT OR IGNORE INTO day_plans (date) VALUES (?)").run(date);
    workoutDb.prepare("DELETE FROM day_plan_items WHERE date = ?").run(date);
    const insert = workoutDb.prepare(
      "INSERT INTO day_plan_items (date, position, sequence_id, optional) VALUES (?, ?, ?, ?)"
    );
    items.forEach((item, i) => insert.run(date, i, item.sequenceId, item.optional ? 1 : 0));
  })();
}

/** Back to the schedule */
export function resetDayPlan(date: string): void {
  workoutDb.prepare("DELETE FROM day_plans WHERE date = ?").run(date);
}

/** Moves one planned session from a date to another. Returns false if it wasn't planned there. */
export function movePlannedSession(from: string, to: string, sequenceId: string): boolean {
  return workoutDb.transaction(() => {
    const source = effectivePlan(from);
    const index = source.findIndex((i) => i.sequenceId === sequenceId);
    if (index === -1) return false;
    const [moved] = source.splice(index, 1);
    setDayPlan(from, source);
    if (from !== to) setDayPlan(to, [...effectivePlan(to), moved]);
    return true;
  })();
}

// --- Sessions ---

export interface SessionSummary {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  finished_at: string | null;
  word: string | null;
  effort: number | null;
  conscientiousness: number | null;
  total: number;
  done: number;
  skipped: number;
}

export interface SessionItem {
  id: number;
  position: number;
  name: string;
  cue: string;
  label: string;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_seconds: number | null;
  target_seconds_max: number | null;
  target_weight: number | null;
  unit: Unit;
  per_side: number;
  extra_side: Side | null;
  sets_done: number;
  skipped: number;
  weight: number | null;
  seconds: number | null;
  notes: string;
  exercise_id: string | null;
  ladder_id: string | null;
  rung: number | null;
  weighted: number;
  timed: number;
  to_failure: number;
  hit_top: number;
  /** Reps reached per set (to-failure exercises), index 0 = set 1 */
  set_reps: (number | null)[];
  /** Reps per set from the last time this exercise was logged elsewhere, as hints */
  last_set_reps: (number | null)[];
  /** The latest note on this exercise from a session before this one */
  last_note: LatestNote | null;
  /** How to do it, read live from the exercise */
  description: string;
  cues: string[];
}

export interface PastNote {
  date: string;
  text: string;
}

export interface LatestNote extends PastNote {
  /** How many earlier notes there are, this one included */
  count: number;
}

export interface Session {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  notes: string;
  finished_at: string | null;
  word: string | null;
  effort: number | null;
  conscientiousness: number | null;
  /** Session notes from the last time this sequence was done before this session */
  last_session_note: LatestNote | null;
  items: SessionItem[];
}

// "Before this session": an earlier date, or the same date but started earlier
const BEFORE_SQL = "(s.date < @date OR (s.date = @date AND s.id < @id))";

const PAST_NOTE_SQL = {
  // Notes on one exercise, from any sequence
  exercise: `SELECT s.date, i.notes AS text FROM session_items i JOIN sessions s ON s.id = i.session_id
             WHERE i.exercise_id = @key AND trim(i.notes) != '' AND ${BEFORE_SQL}`,
  // Session notes for one sequence
  sequence: `SELECT s.date, s.notes AS text FROM sessions s
             WHERE s.sequence_id = @key AND trim(s.notes) != '' AND ${BEFORE_SQL}`,
};

/** Notes written before this session, newest first */
export function pastNotes(
  kind: keyof typeof PAST_NOTE_SQL,
  key: string,
  session: { id: number; date: string },
  limit = 100
): PastNote[] {
  return workoutDb
    .prepare(`${PAST_NOTE_SQL[kind]} ORDER BY s.date DESC, s.id DESC LIMIT @limit`)
    .all({ key, id: session.id, date: session.date, limit }) as PastNote[];
}

/** The latest earlier note, with how many there are in all */
function latestNote(kind: keyof typeof PAST_NOTE_SQL, key: string, session: { id: number; date: string }): LatestNote | null {
  const [latest] = pastNotes(kind, key, session, 1);
  if (!latest) return null;
  const { n } = workoutDb
    .prepare(`SELECT COUNT(*) AS n FROM (${PAST_NOTE_SQL[kind]})`)
    .get({ key, id: session.id, date: session.date }) as { n: number };
  return { ...latest, count: n };
}

// Sets to tick: the target (a single check if none), plus the extra set on a biased side
const SETS_SQL = "MAX(COALESCE(target_sets, 1), 1) + (extra_side IS NOT NULL)";
const DONE_SQL = `skipped = 0 AND sets_done >= ${SETS_SQL}`;

function totalSets(item: { target_sets: number | null; extra_side: Side | null }): number {
  return Math.max(item.target_sets ?? 1, 1) + (item.extra_side ? 1 : 0);
}

export function listSessions(limit = 30): SessionSummary[] {
  return workoutDb
    .prepare(
      `SELECT s.id, s.sequence_id, s.sequence_name, s.date, s.finished_at, s.word, s.effort,
              s.conscientiousness, COUNT(i.id) AS total,
              COALESCE(SUM(CASE WHEN ${DONE_SQL} THEN 1 ELSE 0 END), 0) AS done,
              COALESCE(SUM(i.skipped), 0) AS skipped
       FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id
       GROUP BY s.id
       ORDER BY s.date DESC, s.id DESC
       LIMIT ?`
    )
    .all(limit) as SessionSummary[];
}

export function getSession(id: number): Session | null {
  const session = workoutDb
    .prepare("SELECT id, sequence_id, sequence_name, date, notes, finished_at, word, effort, conscientiousness FROM sessions WHERE id = ?")
    .get(id) as Omit<Session, "items" | "last_session_note"> | undefined;
  if (!session) return null;
  const items = workoutDb
    .prepare(
      `SELECT id, position, name, cue, label, target_sets, target_reps, target_reps_max, target_seconds,
              target_seconds_max, target_weight, unit, per_side, extra_side, sets_done, skipped, weight,
              seconds, notes, exercise_id, ladder_id, rung, weighted, timed, to_failure, hit_top
       FROM session_items WHERE session_id = ? ORDER BY position`
    )
    .all(id) as Omit<SessionItem, "set_reps" | "last_set_reps" | "last_note" | "description" | "cues">[];
  const guides = getGuides([...new Set(items.map((i) => i.exercise_id).filter((e): e is string => !!e))]);
  const sets = workoutDb
    .prepare(
      `SELECT ss.session_item_id, ss.set_number, ss.reps FROM session_sets ss
       JOIN session_items i ON i.id = ss.session_item_id WHERE i.session_id = ?`
    )
    .all(id) as { session_item_id: number; set_number: number; reps: number }[];
  return {
    ...session,
    last_session_note: latestNote("sequence", session.sequence_id, session),
    items: items.map((item) => {
      const setReps: (number | null)[] = Array(totalSets(item)).fill(null);
      sets
        .filter((s) => s.session_item_id === item.id && s.set_number <= setReps.length)
        .forEach((s) => (setReps[s.set_number - 1] = s.reps));
      const guide = (item.exercise_id && guides.get(item.exercise_id)) || { description: "", cues: [] };
      const lastSetReps: (number | null)[] = Array(totalSets(item)).fill(null);
      if (item.to_failure && item.exercise_id) {
        lastSetRepsFor(item.exercise_id, session.id)
          .filter((r) => r.set_number <= lastSetReps.length)
          .forEach((r) => (lastSetReps[r.set_number - 1] = r.reps));
      }
      const lastNote = item.exercise_id ? latestNote("exercise", item.exercise_id, session) : null;
      return { ...item, set_reps: setReps, last_set_reps: lastSetReps, last_note: lastNote, ...guide };
    }),
  };
}

/** The sets logged the most recent other time this exercise had reps recorded */
function lastSetRepsFor(exerciseId: string, excludeSessionId: number): { set_number: number; reps: number }[] {
  const item = workoutDb
    .prepare(
      `SELECT i.id FROM session_items i JOIN sessions s ON s.id = i.session_id
       WHERE i.exercise_id = ? AND s.id != ?
         AND EXISTS (SELECT 1 FROM session_sets ss WHERE ss.session_item_id = i.id)
       ORDER BY s.date DESC, s.id DESC LIMIT 1`
    )
    .get(exerciseId, excludeSessionId) as { id: number } | undefined;
  if (!item) return [];
  return workoutDb
    .prepare("SELECT set_number, reps FROM session_sets WHERE session_item_id = ? ORDER BY set_number")
    .all(item.id) as { set_number: number; reps: number }[];
}

export function findSession(sequenceId: string, date: string): number | null {
  const row = workoutDb
    .prepare("SELECT id FROM sessions WHERE sequence_id = ? AND date = ? ORDER BY id LIMIT 1")
    .get(sequenceId, date) as { id: number } | undefined;
  return row?.id ?? null;
}

export const createSession = workoutDb.transaction((sequence: ResolvedSequence, date: string): number => {
  const { lastInsertRowid } = workoutDb
    .prepare("INSERT INTO sessions (sequence_id, sequence_name, date) VALUES (?, ?, ?)")
    .run(sequence.id, sequence.name, date);
  const insertItem = workoutDb.prepare(
    `INSERT INTO session_items
       (session_id, position, name, cue, label, target_sets, target_reps, target_reps_max, target_seconds,
        target_seconds_max, target_weight, unit, per_side, extra_side, exercise_id, ladder_id, rung,
        weighted, timed, to_failure, weight, seconds)
     VALUES (@session_id, @position, @name, @cue, @label, @sets, @reps, @reps_max, @seconds,
        @seconds_max, @weight, @unit, @per_side, @extra_side, @exercise_id, @ladder_id, @rung,
        @weighted, @timed, @to_failure, @last_weight, @last_seconds)`
  );
  // Start from what was entered the last time this exercise was done, in any sequence
  const last = (column: "weight" | "seconds", exerciseId: string): number | null =>
    (
      workoutDb
        .prepare(
          `SELECT i.${column} AS value FROM session_items i JOIN sessions s ON s.id = i.session_id
           WHERE i.exercise_id = ? AND i.${column} IS NOT NULL AND s.id != ?
           ORDER BY s.date DESC, s.id DESC LIMIT 1`
        )
        .get(exerciseId, lastInsertRowid) as { value: number } | undefined
    )?.value ?? null;
  sequence.items.forEach((item, position) => {
    insertItem.run({
      session_id: lastInsertRowid,
      position,
      name: item.name,
      cue: item.cue ?? "",
      label: item.label ?? "",
      sets: item.sets ?? null,
      reps: item.reps ?? null,
      reps_max: item.repsMax ?? null,
      seconds: item.seconds ?? null,
      seconds_max: item.secondsMax ?? null,
      weight: item.weight ?? null,
      unit: item.unit ?? "reps",
      per_side: item.perSide ? 1 : 0,
      extra_side: item.extraSide ?? null,
      exercise_id: item.exerciseId,
      ladder_id: item.ladderId,
      rung: item.rung,
      weighted: item.weighted ? 1 : 0,
      timed: item.timed ? 1 : 0,
      to_failure: item.toFailure ? 1 : 0,
      last_weight: item.weighted ? last("weight", item.exerciseId) : null,
      last_seconds: item.timed ? last("seconds", item.exerciseId) : null,
    });
  });
  return Number(lastInsertRowid);
});

export interface ItemUpdate {
  hit_top?: number;
  sets_done?: number;
  skipped?: number;
  weight?: number | null;
  seconds?: number | null;
  notes?: string;
}

export function updateSessionItem(sessionId: number, itemId: number, update: ItemUpdate): boolean {
  const fields = Object.keys(update) as (keyof ItemUpdate)[];
  if (fields.length === 0) return true;
  const result = workoutDb
    .prepare(
      `UPDATE session_items SET ${fields.map((f) => `${f} = @${f}`).join(", ")}
       WHERE id = @itemId AND session_id = @sessionId`
    )
    .run({ ...update, itemId, sessionId });
  return result.changes > 0;
}

/**
 * Records (or clears, with null) the reps reached on one set of a to-failure exercise.
 * sets_done follows the number of sets logged. Returns the new sets_done, or null if
 * the item isn't in that session or the set number is out of range.
 */
export const setSessionSetReps = workoutDb.transaction(
  (sessionId: number, itemId: number, setNumber: number, reps: number | null): number | null => {
    const item = workoutDb
      .prepare("SELECT target_sets, extra_side FROM session_items WHERE id = ? AND session_id = ?")
      .get(itemId, sessionId) as { target_sets: number | null; extra_side: Side | null } | undefined;
    if (!item || setNumber < 1 || setNumber > totalSets(item)) return null;
    if (reps === null) {
      workoutDb
        .prepare("DELETE FROM session_sets WHERE session_item_id = ? AND set_number = ?")
        .run(itemId, setNumber);
    } else {
      workoutDb
        .prepare(
          `INSERT INTO session_sets (session_item_id, set_number, reps) VALUES (?, ?, ?)
           ON CONFLICT(session_item_id, set_number) DO UPDATE SET reps = excluded.reps`
        )
        .run(itemId, setNumber, reps);
    }
    const { n } = workoutDb
      .prepare("SELECT COUNT(*) AS n FROM session_sets WHERE session_item_id = ?")
      .get(itemId) as { n: number };
    workoutDb.prepare("UPDATE session_items SET sets_done = ? WHERE id = ?").run(n, itemId);
    return n;
  }
);

export function updateSessionNotes(id: number, notes: string): boolean {
  return workoutDb.prepare("UPDATE sessions SET notes = ? WHERE id = ?").run(notes, id).changes > 0;
}

/** A self-rating out of 5 picked at Finish (null clears it) */
export function setSessionRating(id: number, field: "effort" | "conscientiousness", value: number | null): boolean {
  return workoutDb.prepare(`UPDATE sessions SET ${field} = ? WHERE id = ?`).run(value, id).changes > 0;
}

/** The word picked at Finish (null clears it) */
export function setSessionWord(id: number, word: string | null): boolean {
  return workoutDb.prepare("UPDATE sessions SET word = ? WHERE id = ?").run(word, id).changes > 0;
}

export interface Promotion {
  ladderId: string;
  ladderName: string;
  fromRung: number;
  toRung: number;
  /** The new rung's exercise */
  name: string;
}

/**
 * Moves a ladder up a rung when this session and the previous time that rung was done
 * both hit the top of the range. Run when a session is finished.
 */
export const promoteLadders = workoutDb.transaction((sessionId: number): Promotion[] => {
  const session = workoutDb.prepare("SELECT id, date FROM sessions WHERE id = ?").get(sessionId) as
    | { id: number; date: string }
    | undefined;
  if (!session) return [];
  const items = workoutDb
    .prepare(
      `SELECT i.ladder_id, i.rung, l.name AS ladder_name, l.current_rung,
              (SELECT COUNT(*) FROM ladder_rungs r WHERE r.ladder_id = i.ladder_id) AS rung_count
       FROM session_items i JOIN ladders l ON l.id = i.ladder_id
       WHERE i.session_id = ? AND i.hit_top = 1 AND i.skipped = 0`
    )
    .all(sessionId) as {
    ladder_id: string;
    rung: number;
    ladder_name: string;
    current_rung: number;
    rung_count: number;
  }[];
  const promotions: Promotion[] = [];
  for (const item of items) {
    if (item.current_rung !== item.rung || item.rung >= item.rung_count) continue;
    const previous = workoutDb
      .prepare(
        `SELECT i.hit_top FROM session_items i JOIN sessions s ON s.id = i.session_id
         WHERE i.ladder_id = @ladder AND i.rung = @rung AND i.skipped = 0
           AND (s.date < @date OR (s.date = @date AND s.id < @id))
         ORDER BY s.date DESC, s.id DESC LIMIT 1`
      )
      .get({ ladder: item.ladder_id, rung: item.rung, date: session.date, id: session.id }) as
      | { hit_top: number }
      | undefined;
    if (!previous?.hit_top) continue;
    setLadderRung(item.ladder_id, item.rung + 1);
    const next = workoutDb
      .prepare(
        `SELECT e.name FROM ladder_rungs r JOIN exercises e ON e.id = r.exercise_id
         WHERE r.ladder_id = ? AND r.rung = ?`
      )
      .get(item.ladder_id, item.rung + 1) as { name: string };
    promotions.push({
      ladderId: item.ladder_id,
      ladderName: item.ladder_name,
      fromRung: item.rung,
      toRung: item.rung + 1,
      name: next.name,
    });
  }
  return promotions;
});

// --- Pain reports ---

export interface PainArea {
  id: string;
  name: string;
}

export interface PainReport {
  id: number;
  areaId: string;
  area: string;
  date: string;
  /** 1 to 5, or null if not given */
  intensity: number | null;
  note: string;
}

export function listPainAreas(): PainArea[] {
  return workoutDb.prepare("SELECT id, name FROM pain_areas ORDER BY position, name").all() as PainArea[];
}

/** Adds a body part, or returns the existing one with that name */
export function addPainArea(name: string): PainArea {
  const existing = workoutDb.prepare("SELECT id, name FROM pain_areas WHERE lower(name) = lower(?)").get(name) as
    | PainArea
    | undefined;
  if (existing) return existing;
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "area";
  let id = base;
  for (let n = 2; workoutDb.prepare("SELECT 1 FROM pain_areas WHERE id = ?").get(id); n++) id = `${base}-${n}`;
  const { p } = workoutDb.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pain_areas").get() as { p: number };
  workoutDb.prepare("INSERT INTO pain_areas (id, name, position) VALUES (?, ?, ?)").run(id, name, p);
  return { id, name };
}

export function listPainReports(limit = 20): PainReport[] {
  return workoutDb
    .prepare(
      `SELECT r.id, r.area_id AS areaId, a.name AS area, r.date, r.intensity, r.note
       FROM pain_reports r JOIN pain_areas a ON a.id = r.area_id
       ORDER BY r.date DESC, r.id DESC LIMIT ?`
    )
    .all(limit) as PainReport[];
}

export function addPainReport(areaId: string, date: string, intensity: number | null, note: string): number | null {
  if (!workoutDb.prepare("SELECT 1 FROM pain_areas WHERE id = ?").get(areaId)) return null;
  return Number(
    workoutDb
      .prepare("INSERT INTO pain_reports (area_id, date, intensity, note) VALUES (?, ?, ?, ?)")
      .run(areaId, date, intensity, note).lastInsertRowid
  );
}

/** Seconds of rest after a set in this sequence (0 = none) */
export function getRestSeconds(sequenceId: string): number {
  const row = workoutDb.prepare("SELECT rest_seconds FROM sequences WHERE id = ?").get(sequenceId) as
    | { rest_seconds: number }
    | undefined;
  return row?.rest_seconds ?? 0;
}

export function setRestSeconds(sequenceId: string, seconds: number): void {
  workoutDb.prepare("UPDATE sequences SET rest_seconds = ? WHERE id = ?").run(seconds, sequenceId);
}

export function deletePainReport(id: number): boolean {
  return workoutDb.prepare("DELETE FROM pain_reports WHERE id = ?").run(id).changes > 0;
}

export function setSessionFinished(id: number, finished: boolean): boolean {
  return (
    workoutDb
      .prepare(
        `UPDATE sessions SET finished_at = CASE WHEN ? THEN COALESCE(finished_at, CURRENT_TIMESTAMP) END
         WHERE id = ?`
      )
      .run(finished ? 1 : 0, id).changes > 0
  );
}

export interface DaySession {
  id: number;
  date: string;
  sequenceId: string;
  sequenceName: string;
  finished: boolean;
  word: string | null;
  done: number;
  total: number;
}

export function listSessionsBetween(from: string, to: string): DaySession[] {
  const rows = workoutDb
    .prepare(
      `SELECT s.id, s.date, s.sequence_id, s.sequence_name, s.finished_at, s.word, COUNT(i.id) AS total,
              COALESCE(SUM(CASE WHEN ${DONE_SQL} THEN 1 ELSE 0 END), 0) AS done
       FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id
       WHERE s.date BETWEEN ? AND ? GROUP BY s.id ORDER BY s.date, s.id`
    )
    .all(from, to) as {
    id: number;
    date: string;
    sequence_id: string;
    sequence_name: string;
    finished_at: string | null;
    word: string | null;
    done: number;
    total: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    sequenceId: r.sequence_id,
    sequenceName: r.sequence_name,
    finished: r.finished_at !== null,
    word: r.word,
    done: r.done,
    total: r.total,
  }));
}

export function deleteSession(id: number): void {
  workoutDb.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

migrate();
