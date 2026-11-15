import Database from "better-sqlite3";
import { dirname, join } from "path";
import { seedExercises, seedSequences } from "./seed.js";
import type { Exercise, Sequence, ResolvedSequence, ResolvedSequenceItem } from "./types.js";

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
// Append new ones; never edit or reorder a migration that has shipped.
const SLUG_CHECK = (col: string) =>
  `CHECK (${col} GLOB '[a-z0-9]*' AND ${col} NOT GLOB '*[^a-z0-9-]*' AND length(${col}) <= 64)`;

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

    seedExercises.forEach(saveExercise);
    seedSequences.forEach((seq) => saveSequence(seq));

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

export function listExercises(): Exercise[] {
  const rows = workoutDb
    .prepare("SELECT id, name, weighted, timed, to_failure FROM exercises ORDER BY name")
    .all() as ExerciseRow[];
  return rows.map(toExercise);
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

/** Returns the ids in the list that aren't exercises */
export function unknownExercises(ids: string[]): string[] {
  const known = new Set(listExercises().map((e) => e.id));
  return [...new Set(ids)].filter((id) => !known.has(id));
}

// --- Sequences ---

interface SequenceItemRow extends ExerciseRow {
  sequence_id: string;
  exercise_id: string;
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  weight: number | null;
  cue: string;
}

/** Active (not archived) sequences in home-screen order, with exercise details */
export function listSequences(): ResolvedSequence[] {
  const seqs = workoutDb
    .prepare("SELECT id, name FROM sequences WHERE archived = 0 ORDER BY position, id")
    .all() as { id: string; name: string }[];
  const items = workoutDb
    .prepare(
      `SELECT si.sequence_id, si.exercise_id, si.sets, si.reps, si.seconds, si.weight, si.cue,
              e.id, e.name, e.weighted, e.timed, e.to_failure
       FROM sequence_items si JOIN exercises e ON e.id = si.exercise_id
       ORDER BY si.sequence_id, si.position`
    )
    .all() as SequenceItemRow[];
  return seqs.map((seq) => ({
    ...seq,
    items: items
      .filter((r) => r.sequence_id === seq.id)
      .map((r): ResolvedSequenceItem => {
        const item: ResolvedSequenceItem = { exerciseId: r.exercise_id, ...toExercise(r) };
        delete (item as Partial<Exercise>).id;
        if (r.sets !== null) item.sets = r.sets;
        if (r.reps !== null) item.reps = r.reps;
        if (r.seconds !== null) item.seconds = r.seconds;
        if (r.weight !== null) item.weight = r.weight;
        if (r.cue) item.cue = r.cue;
        return item;
      }),
  }));
}

export function getSequence(id: string): ResolvedSequence | null {
  return listSequences().find((s) => s.id === id) ?? null;
}

/**
 * Insert or replace a sequence and its whole exercise list, and un-archive it.
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
      `INSERT INTO sequence_items (sequence_id, position, exercise_id, sets, reps, seconds, weight, cue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    seq.items.forEach((item, i) => {
      insert.run(
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

export interface SessionSummary {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  total: number;
  done: number;
  skipped: number;
}

export interface SessionItem {
  id: number;
  position: number;
  name: string;
  cue: string;
  target_sets: number | null;
  target_reps: number | null;
  target_seconds: number | null;
  target_weight: number | null;
  sets_done: number;
  skipped: number;
  weight: number | null;
  seconds: number | null;
  notes: string;
  exercise_id: string | null;
  weighted: number;
  timed: number;
  to_failure: number;
  /** Reps reached per set (to-failure exercises), index 0 = set 1 */
  set_reps: (number | null)[];
}

export interface Session {
  id: number;
  sequence_id: string;
  sequence_name: string;
  date: string;
  notes: string;
  items: SessionItem[];
}

// An exercise without a set count is a single check-off
const DONE_SQL = "skipped = 0 AND sets_done >= MAX(COALESCE(target_sets, 1), 1)";

export function listSessions(limit = 30): SessionSummary[] {
  return workoutDb
    .prepare(
      `SELECT s.id, s.sequence_id, s.sequence_name, s.date,
              COUNT(i.id) AS total,
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
    .prepare("SELECT id, sequence_id, sequence_name, date, notes FROM sessions WHERE id = ?")
    .get(id) as Omit<Session, "items"> | undefined;
  if (!session) return null;
  const items = workoutDb
    .prepare(
      `SELECT id, position, name, cue, target_sets, target_reps, target_seconds, target_weight,
              sets_done, skipped, weight, seconds, notes, exercise_id, weighted, timed, to_failure
       FROM session_items WHERE session_id = ? ORDER BY position`
    )
    .all(id) as Omit<SessionItem, "set_reps">[];
  const sets = workoutDb
    .prepare(
      `SELECT ss.session_item_id, ss.set_number, ss.reps FROM session_sets ss
       JOIN session_items i ON i.id = ss.session_item_id WHERE i.session_id = ?`
    )
    .all(id) as { session_item_id: number; set_number: number; reps: number }[];
  return {
    ...session,
    items: items.map((item) => {
      const setReps: (number | null)[] = Array(Math.max(item.target_sets ?? 1, 1)).fill(null);
      sets
        .filter((s) => s.session_item_id === item.id && s.set_number <= setReps.length)
        .forEach((s) => (setReps[s.set_number - 1] = s.reps));
      return { ...item, set_reps: setReps };
    }),
  };
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
       (session_id, position, name, cue, target_sets, target_reps, target_seconds, target_weight,
        exercise_id, weighted, timed, to_failure)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  sequence.items.forEach((item, position) => {
    insertItem.run(
      lastInsertRowid,
      position,
      item.name,
      item.cue ?? "",
      item.sets ?? null,
      item.reps ?? null,
      item.seconds ?? null,
      item.weight ?? null,
      item.exerciseId,
      item.weighted ? 1 : 0,
      item.timed ? 1 : 0,
      item.toFailure ? 1 : 0
    );
  });
  return Number(lastInsertRowid);
});

export interface ItemUpdate {
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
      .prepare("SELECT target_sets FROM session_items WHERE id = ? AND session_id = ?")
      .get(itemId, sessionId) as { target_sets: number | null } | undefined;
    if (!item || setNumber < 1 || setNumber > Math.max(item.target_sets ?? 1, 1)) return null;
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

export function deleteSession(id: number): void {
  workoutDb.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

migrate();
