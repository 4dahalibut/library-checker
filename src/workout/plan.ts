// Plans the current week from weekly goals. Nothing here is stored: past days show
// what actually happened, and today onward is recomputed from what's left, so doing
// something different from the plan just reshuffles the rest of the week.

import type { DayPin, DaySession, Goal } from "./db.js";

/** Monday = 0 … Sunday = 6. Workout days unless a pin says otherwise. */
const DEFAULT_WORKOUT_WEEKDAYS = new Set([0, 1, 2, 3, 4]);

export interface PlannedDay {
  date: string;
  /** Monday = 0 */
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  sessions: DaySession[];
  /** What today or a future day holds; null for past days */
  plan: {
    /** null = rest */
    sequenceId: string | null;
    /** session: today's started session; pin: set by hand; auto: from goals; default: weekend rest */
    source: "session" | "pin" | "auto" | "default";
  } | null;
}

export interface GoalProgress extends Goal {
  /** Finished sessions this week */
  done: number;
}

export interface WeekPlan {
  start: string;
  end: string;
  days: PlannedDay[];
  goals: GoalProgress[];
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Monday of the week holding this date */
export function weekStart(date: string): string {
  const weekday = (parseDate(date).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export function planWeek(input: {
  today: string;
  goals: Goal[];
  /** Sessions from the day before the week through its end */
  sessions: DaySession[];
  pins: DayPin[];
}): WeekPlan {
  const { today, goals, sessions, pins } = input;
  const start = weekStart(today);
  const end = addDays(start, 6);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const goalIds = goals.map((g) => g.sequenceId);
  const isGoal = (id: string | null): id is string => id !== null && goalIds.includes(id);

  const sessionsOn = (date: string) => sessions.filter((s) => s.date === date);
  const pinOn = (date: string) => pins.find((p) => p.date === date);

  const done = new Map(goals.map((g) => [g.sequenceId, 0]));
  for (const s of sessions) {
    if (s.finished && s.date >= start && s.date <= end && isGoal(s.sequenceId)) {
      done.set(s.sequenceId, done.get(s.sequenceId)! + 1);
    }
  }

  const days: PlannedDay[] = dates.map((date, weekday) => ({
    date,
    weekday,
    isToday: date === today,
    isPast: date < today,
    sessions: sessionsOn(date),
    plan: null,
  }));

  // First pass: fix today's session and pinned days, so automatic days can't use
  // up a sequence that's already spoken for later in the week
  const remaining = new Map(goals.map((g) => [g.sequenceId, g.perWeek - done.get(g.sequenceId)!]));
  const reserve = (id: string | null) => {
    if (isGoal(id)) remaining.set(id, remaining.get(id)! - 1);
  };
  const open: PlannedDay[] = [];
  for (const day of days) {
    if (day.isPast) continue;
    const todays = day.isToday ? day.sessions.find((s) => isGoal(s.sequenceId)) ?? day.sessions[0] : undefined;
    const pin = pinOn(day.date);
    if (todays) {
      day.plan = { sequenceId: todays.sequenceId, source: "session" };
      if (!todays.finished) reserve(todays.sequenceId);
    } else if (pin) {
      day.plan = { sequenceId: pin.sequenceId, source: "pin" };
      reserve(pin.sequenceId);
    } else if (!DEFAULT_WORKOUT_WEEKDAYS.has(day.weekday)) {
      day.plan = { sequenceId: null, source: "default" };
    } else {
      open.push(day);
    }
  }

  // What the day before holds, for not doubling up on back-to-back days
  const previousSequence = (date: string): string | null => {
    const prev = addDays(date, -1);
    const planned = days.find((d) => d.date === prev && !d.isPast)?.plan;
    if (planned) return planned.sequenceId;
    const finished = sessionsOn(prev).filter((s) => s.finished);
    return finished.length ? finished[finished.length - 1].sequenceId : null;
  };

  // Second pass, in date order: the sequence with the most left to do, never the
  // same as the day before (that's only on purpose, via a pin); ties go by goal order
  for (const day of open) {
    const prev = previousSequence(day.date);
    let pick: string | null = null;
    for (const id of goalIds) {
      const left = remaining.get(id)!;
      if (left <= 0 || id === prev) continue;
      if (pick === null || left > remaining.get(pick)!) pick = id;
    }
    day.plan = { sequenceId: pick, source: "auto" };
    reserve(pick);
  }

  return {
    start,
    end,
    days,
    goals: goals.map((g) => ({ ...g, done: done.get(g.sequenceId)! })),
  };
}
