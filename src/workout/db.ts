import Database from "better-sqlite3";
import { dirname, join } from "path";
import type { Sequence } from "./sequences.js";

// Default to the same directory as the library DB so it lands on the same volume
const dbPath =
  process.env.WORKOUT_DATABASE_PATH ||
  join(dirname(process.env.DATABASE_PATH || "data/library.db"), "workout.db");
export const workoutDb = new Database(dbPath);

workoutDb.pragma("journal_mode = WAL");
workoutDb.pragma("foreign_keys = ON");

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
              sets_done, skipped, weight, seconds, notes
       FROM session_items WHERE session_id = ? ORDER BY position`
    )
    .all(id) as SessionItem[];
  return { ...session, items };
}

export function findSession(sequenceId: string, date: string): number | null {
  const row = workoutDb
    .prepare("SELECT id FROM sessions WHERE sequence_id = ? AND date = ? ORDER BY id LIMIT 1")
    .get(sequenceId, date) as { id: number } | undefined;
  return row?.id ?? null;
}

export const createSession = workoutDb.transaction((sequence: Sequence, date: string): number => {
  const { lastInsertRowid } = workoutDb
    .prepare("INSERT INTO sessions (sequence_id, sequence_name, date) VALUES (?, ?, ?)")
    .run(sequence.id, sequence.name, date);
  const insertItem = workoutDb.prepare(
    `INSERT INTO session_items
       (session_id, position, name, cue, target_sets, target_reps, target_seconds, target_weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
      item.weight ?? null
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

export function updateSessionNotes(id: number, notes: string): boolean {
  return workoutDb.prepare("UPDATE sessions SET notes = ? WHERE id = ?").run(notes, id).changes > 0;
}

export function deleteSession(id: number): void {
  workoutDb.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
