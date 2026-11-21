import { Router, type RequestHandler } from "express";
import { createHash, timingSafeEqual } from "crypto";
import type { Exercise, Ladder, PlanItem, Rung, Sequence, SequenceItem, Unit } from "./types.js";
import { buildWeek, weekStart, addDays } from "./plan.js";
import {
  workoutDb,
  listExercises,
  saveExercise,
  saveGuide,
  unknownExercises,
  listSequences,
  getSequence,
  saveSequence,
  archiveSequence,
  setSessionSetReps,
  setSessionFinished,
  promoteLadders,
  listPainAreas,
  addPainArea,
  listPainReports,
  addPainReport,
  deletePainReport,
  getRestSeconds,
  setRestSeconds,
  setExerciseRest,
  setSessionWord,
  setSessionRating,
  pastNotes,
  unknownLadders,
  unknownSequences,
  listLadders,
  getLadder,
  saveLadder,
  setLadderRung,
  getSchedule,
  saveSchedule,
  getDayPlans,
  setDayPlan,
  resetDayPlan,
  movePlannedSession,
  listSessionsBetween,
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
  const { name, weighted, timed, toFailure, restSeconds } = req.body ?? {};
  if (restSeconds !== undefined && restSeconds !== null && !(Number.isInteger(restSeconds) && restSeconds >= 0 && restSeconds <= 600)) {
    res.status(400).json({ error: "restSeconds must be 0 to 600, or null to use the sequence's" });
    return;
  }
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
  // Left alone unless given; null goes back to the sequence's rest
  if (restSeconds !== undefined) setExerciseRest(id, restSeconds);
  res.json({ exercise, restSeconds: listExercises().find((e) => e.id === id)?.restSeconds ?? null });
});

// --- Ladders ---

const UNITS: Unit[] = ["reps", "breaths", "steps", "m"];

function parseRung(raw: unknown, index: number): Rung | string {
  const where = `rungs[${index}]`;
  if (typeof raw !== "object" || raw === null) return `${where} must be an object`;
  const { exerciseId, sets, reps, repsMax, seconds, secondsMax, unit, perSide, weight, cue } = raw as Record<
    string,
    unknown
  >;
  if (typeof exerciseId !== "string") return `${where}.exerciseId is required`;
  const rung: Rung = { exerciseId };
  for (const [key, value] of Object.entries({ sets, reps, repsMax, seconds, secondsMax })) {
    if (value === undefined || value === null) continue;
    if (!isPositiveInt(value)) return `${where}.${key} must be a whole number above 0`;
    rung[key as "sets" | "reps" | "repsMax" | "seconds" | "secondsMax"] = value;
  }
  if (rung.repsMax !== undefined && !(rung.reps !== undefined && rung.repsMax > rung.reps)) {
    return `${where}.repsMax must be above reps`;
  }
  if (rung.secondsMax !== undefined && !(rung.seconds !== undefined && rung.secondsMax > rung.seconds)) {
    return `${where}.secondsMax must be above seconds`;
  }
  if (unit !== undefined && unit !== null) {
    if (!UNITS.includes(unit as Unit)) return `${where}.unit must be one of ${UNITS.join(", ")}`;
    if (unit !== "reps") rung.unit = unit as Unit;
  }
  if (perSide !== undefined && perSide !== null) {
    if (typeof perSide !== "boolean") return `${where}.perSide must be true or false`;
    if (perSide) rung.perSide = true;
  }
  if (weight !== undefined && weight !== null) {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) return `${where}.weight must be a number`;
    rung.weight = weight;
  }
  if (cue !== undefined && cue !== null && cue !== "") {
    if (typeof cue !== "string") return `${where}.cue must be text`;
    rung.cue = cue.trim();
  }
  return rung;
}

workoutRouter.get("/api/ladders", (_req, res) => {
  res.json({ ladders: listLadders() });
});

// Replaces the ladder's name, side bias and rungs; the current rung stays put
workoutRouter.put("/api/ladders/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, extraSide, rungs } = req.body ?? {};
  if (!SLUG_RE.test(id)) {
    res.status(400).json({ error: "id must be lowercase letters, digits and dashes" });
    return;
  }
  if (!isName(name)) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (extraSide !== undefined && extraSide !== null && extraSide !== "left" && extraSide !== "right") {
    res.status(400).json({ error: "extraSide must be left, right or null" });
    return;
  }
  if (!Array.isArray(rungs) || rungs.length === 0 || rungs.length > 20) {
    res.status(400).json({ error: "rungs must be a list of 1 to 20" });
    return;
  }
  const parsed: Rung[] = [];
  for (const [i, raw] of rungs.entries()) {
    const rung = parseRung(raw, i);
    if (typeof rung === "string") {
      res.status(400).json({ error: rung });
      return;
    }
    parsed.push(rung);
  }
  const unknown = unknownExercises(parsed.map((r) => r.exerciseId));
  if (unknown.length) {
    res.status(400).json({ error: `Unknown exercises (create them first): ${unknown.join(", ")}` });
    return;
  }
  const ladder: Ladder = { id, name: name.trim(), rungs: parsed };
  if (extraSide) ladder.extraSide = extraSide;
  saveLadder(ladder);
  res.json({ ladder: getLadder(id) });
});

// Moving up or down a rung is done from the app, so it's open like logging
workoutRouter.put("/api/ladders/:id/rung", (req, res) => {
  const { rung } = req.body ?? {};
  if (!Number.isInteger(rung) || !setLadderRung(req.params.id, rung)) {
    res.status(400).json({ error: "No such rung on that ladder" });
    return;
  }
  res.json({ ladder: getLadder(req.params.id) });
});

// --- Sequences ---

// How to do an exercise: a description and an ordered list of cues (full replace)
workoutRouter.put("/api/exercises/:id/guide", requireAdmin, (req, res) => {
  const { description, cues } = req.body ?? {};
  if (unknownExercises([req.params.id]).length) {
    res.status(404).json({ error: "Unknown exercise" });
    return;
  }
  if (typeof description !== "string" || description.length > 2000) {
    res.status(400).json({ error: "description must be text" });
    return;
  }
  if (
    !Array.isArray(cues) ||
    cues.length > 30 ||
    !cues.every((c) => typeof c === "string" && c.trim().length > 0 && c.length <= 500)
  ) {
    res.status(400).json({ error: "cues must be a list of non-empty text" });
    return;
  }
  saveGuide(req.params.id, { description: description.trim(), cues: cues.map((c: string) => c.trim()) });
  res.json({ success: true });
});

workoutRouter.get("/api/sequences", (_req, res) => {
  res.json({ sequences: listSequences() });
});

function parseItem(raw: unknown, index: number): SequenceItem | string {
  if (typeof raw !== "object" || raw === null) return `items[${index}] must be an object`;
  const { ladderId, label } = raw as Record<string, unknown>;
  if (typeof ladderId !== "string") return `items[${index}].ladderId is required`;
  const item: SequenceItem = { ladderId };
  if (label !== undefined && label !== null && label !== "") {
    if (typeof label !== "string" || label.length > 20) return `items[${index}].label must be short text`;
    item.label = label.trim();
  }
  return item;
}

// Replaces the sequence's name and whole slot list (and restores it if archived)
workoutRouter.put("/api/sequences/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, items, position, restSeconds } = req.body ?? {};
  if (restSeconds !== undefined && !(Number.isInteger(restSeconds) && restSeconds >= 0 && restSeconds <= 600)) {
    res.status(400).json({ error: "restSeconds must be 0 to 600" });
    return;
  }
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
  const unknown = unknownLadders(parsed.map((i) => i.ladderId));
  if (unknown.length) {
    res.status(400).json({ error: `Unknown ladders (create them first): ${unknown.join(", ")}` });
    return;
  }
  const sequence: Sequence = { id, name: name.trim(), items: parsed };
  saveSequence(sequence, position);
  if (restSeconds !== undefined) setRestSeconds(id, restSeconds);
  res.json({ sequence: getSequence(id), restSeconds: getRestSeconds(id) });
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
  res.json({ session: { ...session, rest_seconds: getRestSeconds(session.sequence_id) } });
});

// Every note written before this session: on one of its exercises, or for its sequence
workoutRouter.get("/api/sessions/:id/past-notes", (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const itemId = req.query.item;
  if (itemId === undefined) {
    res.json({ notes: pastNotes("sequence", session.sequence_id, session) });
    return;
  }
  const item = session.items.find((i) => i.id === Number(itemId));
  if (!item) {
    res.status(404).json({ error: "Exercise not found" });
    return;
  }
  res.json({ notes: item.exercise_id ? pastNotes("exercise", item.exercise_id, session) : [] });
});

workoutRouter.patch("/api/sessions/:id/items/:itemId", (req, res) => {
  const { sets_done, skipped, weight, seconds, notes, hit_top } = req.body;
  const update: ItemUpdate = {};
  if (hit_top !== undefined) {
    if (typeof hit_top !== "boolean") {
      res.status(400).json({ error: "hit_top must be true or false" });
      return;
    }
    update.hit_top = hit_top ? 1 : 0;
  }
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
  const { notes, finished, word, effort, conscientiousness } = req.body ?? {};
  const id = Number(req.params.id);
  const ratings = { effort, conscientiousness };
  if ([notes, finished, word, effort, conscientiousness].every((v) => v === undefined)) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  if (notes !== undefined && typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }
  if (finished !== undefined && typeof finished !== "boolean") {
    res.status(400).json({ error: "finished must be true or false" });
    return;
  }
  if (word !== undefined && word !== null && !(typeof word === "string" && word.trim().length > 0 && word.length <= 40)) {
    res.status(400).json({ error: "word must be short text or null" });
    return;
  }
  for (const [field, value] of Object.entries(ratings)) {
    if (value !== undefined && value !== null && !(Number.isInteger(value) && value >= 1 && value <= 5)) {
      res.status(400).json({ error: `${field} must be 1 to 5 or null` });
      return;
    }
  }
  const found =
    Object.entries(ratings).every(
      ([field, value]) => value === undefined || setSessionRating(id, field as keyof typeof ratings, value)
    ) &&
    (notes === undefined || updateSessionNotes(id, notes)) &&
    (finished === undefined || setSessionFinished(id, finished)) &&
    (word === undefined || setSessionWord(id, word === null ? null : word.trim()));
  if (!found) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // Finishing can move ladders up a rung
  res.json({ success: true, promotions: finished === true ? promoteLadders(id) : [] });
});

// --- Pain reports ---
// Logged from the app, so open like the rest of the logging

workoutRouter.get("/api/pain", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  res.json({ areas: listPainAreas(), reports: listPainReports(limit) });
});

workoutRouter.post("/api/pain/areas", (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 40) {
    res.status(400).json({ error: "name must be 1 to 40 characters" });
    return;
  }
  res.json({ area: addPainArea(name.trim()) });
});

workoutRouter.post("/api/pain", (req, res) => {
  const { areaId, date, intensity, note } = req.body ?? {};
  if (intensity !== undefined && intensity !== null && !(Number.isInteger(intensity) && intensity >= 1 && intensity <= 5)) {
    res.status(400).json({ error: "intensity must be 1 to 5 or null" });
    return;
  }
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
    res.status(400).json({ error: "note must be short text" });
    return;
  }
  const id = typeof areaId === "string" ? addPainReport(areaId, date, intensity ?? null, (note ?? "").trim()) : null;
  if (id === null) {
    res.status(400).json({ error: "Unknown body part" });
    return;
  }
  res.json({ id, reports: listPainReports() });
});

workoutRouter.delete("/api/pain/:id", (req, res) => {
  deletePainReport(Number(req.params.id));
  res.json({ reports: listPainReports() });
});

// --- Week ---

function parsePlanItems(raw: unknown, where: string): PlanItem[] | string {
  if (!Array.isArray(raw)) return `${where} must be a list`;
  const items: PlanItem[] = [];
  for (const [i, entry] of raw.entries()) {
    const { sequenceId, optional } = (entry ?? {}) as Record<string, unknown>;
    if (typeof sequenceId !== "string") return `${where}[${i}].sequenceId is required`;
    if (optional !== undefined && typeof optional !== "boolean") return `${where}[${i}].optional must be true or false`;
    items.push(optional ? { sequenceId, optional: true } : { sequenceId });
  }
  const unknown = unknownSequences(items.map((i) => i.sequenceId));
  if (unknown.length) return `Unknown sequences: ${unknown.join(", ")}`;
  return items;
}

// The client sends its own today so the week follows the phone's timezone
// offset=1 is next week, 2 the week after, and so on (today stays today)
workoutRouter.get("/api/week", (req, res) => {
  const today = req.query.today;
  if (typeof today !== "string" || !DATE_RE.test(today)) {
    res.status(400).json({ error: "today must be YYYY-MM-DD" });
    return;
  }
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(offset) || offset < -52 || offset > 52) {
    res.status(400).json({ error: "offset must be a whole number of weeks" });
    return;
  }
  // Seven days from `start` when given (home centres them on today), else a Monday-to-Sunday week
  if (req.query.start !== undefined && (typeof req.query.start !== "string" || !DATE_RE.test(req.query.start))) {
    res.status(400).json({ error: "start must be YYYY-MM-DD" });
    return;
  }
  const start = typeof req.query.start === "string" ? req.query.start : addDays(weekStart(today), offset * 7);
  const end = addDays(start, 6);
  const names = new Map(
    (workoutDb.prepare("SELECT id, name FROM sequences").all() as { id: string; name: string }[]).map((r) => [
      r.id,
      r.name,
    ])
  );
  res.json({
    week: buildWeek({
      today,
      start,
      schedule: getSchedule(),
      dayPlans: getDayPlans(start, end),
      sessions: listSessionsBetween(start, end),
      names,
    }),
  });
});

workoutRouter.get("/api/schedule", (_req, res) => {
  res.json({ schedule: getSchedule() });
});

// The weekly schedule (Monday first) and busy-week minimums
workoutRouter.put("/api/schedule", requireAdmin, (req, res) => {
  const { days, minimums } = req.body ?? {};
  if (!Array.isArray(days) || days.length !== 7) {
    res.status(400).json({ error: "days must be a list of 7, Monday first" });
    return;
  }
  const parsedDays: PlanItem[][] = [];
  for (const [d, raw] of days.entries()) {
    const items = parsePlanItems(raw, `days[${d}]`);
    if (typeof items === "string") {
      res.status(400).json({ error: items });
      return;
    }
    parsedDays.push(items);
  }
  const parsedMinimums: { sequenceId: string; perWeek: number }[] = [];
  for (const [sequenceId, perWeek] of Object.entries(minimums ?? {})) {
    if (!(Number.isInteger(perWeek) && (perWeek as number) >= 1 && (perWeek as number) <= 14)) {
      res.status(400).json({ error: `minimums.${sequenceId} must be a whole number from 1 to 14` });
      return;
    }
    parsedMinimums.push({ sequenceId, perWeek: perWeek as number });
  }
  const unknown = unknownSequences(parsedMinimums.map((m) => m.sequenceId));
  if (unknown.length) {
    res.status(400).json({ error: `Unknown sequences: ${unknown.join(", ")}` });
    return;
  }
  saveSchedule({ days: parsedDays, minimums: parsedMinimums });
  res.json({ schedule: getSchedule() });
});

// Changing a day is done from the app, so these are open like logging.
// Replace what one date holds (an empty list makes it a rest day)
workoutRouter.put("/api/days/:date", (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const items = parsePlanItems(req.body?.items, "items");
  if (typeof items === "string") {
    res.status(400).json({ error: items });
    return;
  }
  setDayPlan(date, items);
  res.json({ success: true });
});

// Back to the schedule
workoutRouter.delete("/api/days/:date", (req, res) => {
  resetDayPlan(req.params.date);
  res.json({ success: true });
});

workoutRouter.post("/api/days/move", (req, res) => {
  const { from, to, sequenceId } = req.body ?? {};
  if (typeof from !== "string" || !DATE_RE.test(from) || typeof to !== "string" || !DATE_RE.test(to)) {
    res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
    return;
  }
  if (typeof sequenceId !== "string" || !movePlannedSession(from, to, sequenceId)) {
    res.status(400).json({ error: "That session isn't planned on that day" });
    return;
  }
  res.json({ success: true });
});

workoutRouter.delete("/api/sessions/:id", (req, res) => {
  deleteSession(Number(req.params.id));
  res.json({ success: true });
});
