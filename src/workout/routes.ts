import { Router, type RequestHandler } from "express";
import { createHash, timingSafeEqual } from "crypto";
import type { Exercise, Sequence, SequenceItem } from "./types.js";
import {
  workoutDb,
  listExercises,
  saveExercise,
  unknownExercises,
  listSequences,
  getSequence,
  saveSequence,
  archiveSequence,
  setSessionSetReps,
  listSessions,
  getSession,
  findSession,
  createSession,
  updateSessionItem,
  updateSessionNotes,
  deleteSession,
  type ItemUpdate,
} from "./db.js";

export const workoutRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

workoutRouter.get("/api/health", (_req, res) => {
  workoutDb.prepare("SELECT 1").get();
  res.json({ ok: true });
});

// --- Sequences and exercises ---
// Reads are open like the rest of the app. Writes need WORKOUT_ADMIN_TOKEN as a
// bearer token, since there's no login and the URL is public.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

const requireAdmin: RequestHandler = (req, res, next) => {
  const token = process.env.WORKOUT_ADMIN_TOKEN;
  if (!token) {
    res.status(503).json({ error: "Editing is off: WORKOUT_ADMIN_TOKEN is not set" });
    return;
  }
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !timingSafeEqual(digest(given), digest(token))) {
    res.status(401).json({ error: "Wrong or missing token" });
    return;
  }
  next();
};

function isPositiveInt(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}

function isName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 100;
}

workoutRouter.get("/api/exercises", (_req, res) => {
  res.json({ exercises: listExercises() });
});

// Full replace: every field is required so a rename can't silently reset the switches
workoutRouter.put("/api/exercises/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, weighted, timed, toFailure } = req.body ?? {};
  if (!SLUG_RE.test(id)) {
    res.status(400).json({ error: "id must be lowercase letters, digits and dashes" });
    return;
  }
  if (!isName(name)) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (![weighted, timed, toFailure].every((v) => typeof v === "boolean")) {
    res.status(400).json({ error: "weighted, timed and toFailure must each be true or false" });
    return;
  }
  const exercise: Exercise = { id, name: name.trim(), weighted, timed, toFailure };
  saveExercise(exercise);
  res.json({ exercise });
});

workoutRouter.get("/api/sequences", (_req, res) => {
  res.json({ sequences: listSequences() });
});

function parseItem(raw: unknown, index: number): SequenceItem | string {
  if (typeof raw !== "object" || raw === null) return `items[${index}] must be an object`;
  const { exerciseId, sets, reps, seconds, weight, cue } = raw as Record<string, unknown>;
  if (typeof exerciseId !== "string") return `items[${index}].exerciseId is required`;
  const item: SequenceItem = { exerciseId };
  for (const [key, value] of Object.entries({ sets, reps, seconds })) {
    if (value === undefined || value === null) continue;
    if (!isPositiveInt(value)) return `items[${index}].${key} must be a whole number above 0`;
    item[key as "sets" | "reps" | "seconds"] = value;
  }
  if (weight !== undefined && weight !== null) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
      return `items[${index}].weight must be a number`;
    }
    item.weight = weight;
  }
  if (cue !== undefined && cue !== null && cue !== "") {
    if (typeof cue !== "string") return `items[${index}].cue must be text`;
    item.cue = cue.trim();
  }
  return item;
}

// Replaces the sequence's name and whole exercise list (and restores it if archived)
workoutRouter.put("/api/sequences/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, items, position } = req.body ?? {};
  if (!SLUG_RE.test(id)) {
    res.status(400).json({ error: "id must be lowercase letters, digits and dashes" });
    return;
  }
  if (!isName(name)) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty list" });
    return;
  }
  if (position !== undefined && !(Number.isInteger(position) && position >= 0)) {
    res.status(400).json({ error: "position must be a whole number" });
    return;
  }
  const parsed: SequenceItem[] = [];
  for (const [i, raw] of items.entries()) {
    const item = parseItem(raw, i);
    if (typeof item === "string") {
      res.status(400).json({ error: item });
      return;
    }
    parsed.push(item);
  }
  const unknown = unknownExercises(parsed.map((i) => i.exerciseId));
  if (unknown.length) {
    res.status(400).json({ error: `Unknown exercises (create them first): ${unknown.join(", ")}` });
    return;
  }
  const sequence: Sequence = { id, name: name.trim(), items: parsed };
  saveSequence(sequence, position);
  res.json({ sequence: getSequence(id) });
});

// Archives rather than deletes, so past sessions keep a real sequence behind them
workoutRouter.delete("/api/sequences/:id", requireAdmin, (req, res) => {
  if (!archiveSequence(req.params.id)) {
    res.status(404).json({ error: "Unknown sequence" });
    return;
  }
  res.json({ success: true });
});

// --- Sessions ---

workoutRouter.get("/api/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

// Opens the existing session for that sequence and date, or starts one
workoutRouter.post("/api/sessions", (req, res) => {
  const { sequenceId, date } = req.body;
  const sequence = typeof sequenceId === "string" ? getSequence(sequenceId) : null;
  if (!sequence) {
    res.status(404).json({ error: "Unknown sequence" });
    return;
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const id = findSession(sequence.id, date) ?? createSession(sequence, date);
  res.json({ session: getSession(id) });
});

workoutRouter.get("/api/sessions/:id", (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ session });
});

workoutRouter.patch("/api/sessions/:id/items/:itemId", (req, res) => {
  const { sets_done, skipped, weight, seconds, notes } = req.body;
  const update: ItemUpdate = {};
  if (sets_done !== undefined) {
    if (!Number.isInteger(sets_done) || sets_done < 0) {
      res.status(400).json({ error: "sets_done must be a whole number" });
      return;
    }
    update.sets_done = sets_done;
  }
  if (skipped !== undefined) {
    if (typeof skipped !== "boolean") {
      res.status(400).json({ error: "skipped must be true or false" });
      return;
    }
    update.skipped = skipped ? 1 : 0;
  }
  if (weight !== undefined) {
    if (!isNumberOrNull(weight)) {
      res.status(400).json({ error: "weight must be a number" });
      return;
    }
    update.weight = weight;
  }
  if (seconds !== undefined) {
    if (!isNumberOrNull(seconds)) {
      res.status(400).json({ error: "seconds must be a number" });
      return;
    }
    update.seconds = seconds;
  }
  if (notes !== undefined) {
    if (typeof notes !== "string") {
      res.status(400).json({ error: "notes must be a string" });
      return;
    }
    update.notes = notes;
  }
  const found = updateSessionItem(Number(req.params.id), Number(req.params.itemId), update);
  if (!found) {
    res.status(404).json({ error: "Exercise not found" });
    return;
  }
  res.json({ success: true });
});

// Reps reached on one set of a to-failure exercise; null clears it
workoutRouter.put("/api/sessions/:id/items/:itemId/sets/:set", (req, res) => {
  const { reps } = req.body ?? {};
  if (reps !== null && !(Number.isInteger(reps) && reps >= 0 && reps <= 10000)) {
    res.status(400).json({ error: "reps must be a whole number or null" });
    return;
  }
  const setsDone = setSessionSetReps(
    Number(req.params.id),
    Number(req.params.itemId),
    Number(req.params.set),
    reps
  );
  if (setsDone === null) {
    res.status(404).json({ error: "Set not found" });
    return;
  }
  res.json({ sets_done: setsDone });
});

workoutRouter.patch("/api/sessions/:id", (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }
  if (!updateSessionNotes(Number(req.params.id), notes)) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ success: true });
});

workoutRouter.delete("/api/sessions/:id", (req, res) => {
  deleteSession(Number(req.params.id));
  res.json({ success: true });
});
