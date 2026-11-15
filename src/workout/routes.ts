import { Router } from "express";
import { sequences } from "./sequences.js";
import {
  workoutDb,
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

workoutRouter.get("/api/sequences", (_req, res) => {
  res.json({ sequences });
});

workoutRouter.get("/api/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

// Opens the existing session for that sequence and date, or starts one
workoutRouter.post("/api/sessions", (req, res) => {
  const { sequenceId, date } = req.body;
  const sequence = sequences.find((s) => s.id === sequenceId);
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
