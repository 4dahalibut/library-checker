// Builds the current week: each day's plan (the schedule, or what was changed by
// hand for that date) matched against the sessions actually logged. Missed sessions
// stay missed; nothing is moved to catch up.

import type { DaySession, Schedule } from "./db.js";
import type { PlanItem } from "./types.js";

export interface WeekItem {
  sequenceId: string;
  name: string;
  optional: boolean;
  /** The session logged for it that day, if any */
  session: { id: number; finished: boolean; word: string | null; done: number; total: number } | null;
}

export interface WeekDay {
  date: string;
  /** Monday = 0 */
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  /** Changed by hand rather than following the schedule */
  changed: boolean;
  items: WeekItem[];
  /** Sessions logged that day that weren't planned */
  extras: DaySession[];
}

export interface WeekProgress {
  sequenceId: string;
  name: string;
  /** Planned (non-optional) times per week on the schedule */
  target: number;
  /** Finished this week */
  done: number;
  /** Busy-week floor, if set */
  minimum: number | null;
}

export interface Week {
  start: string;
  end: string;
  days: WeekDay[];
  progress: WeekProgress[];
  /** Whether every busy-week minimum is met so far; null when none are set */
  minimumMet: boolean | null;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week holding this date */
export function weekStart(date: string): string {
  return addDays(date, -((parseDate(date).getUTCDay() + 6) % 7));
}

export function buildWeek(input: {
  today: string;
  schedule: Schedule;
  /** Dates changed by hand */
  dayPlans: Map<string, PlanItem[]>;
  /** Sessions within the week */
  sessions: DaySession[];
  /** Current names of sequences, by id */
  names: Map<string, string>;
}): Week {
  const { today, schedule, dayPlans, sessions, names } = input;
  const start = weekStart(today);
  const end = addDays(start, 6);
  const nameOf = (id: string) => names.get(id) ?? sessions.find((s) => s.sequenceId === id)?.sequenceName ?? id;

  const days: WeekDay[] = Array.from({ length: 7 }, (_, weekday) => {
    const date = addDays(start, weekday);
    const plan = dayPlans.get(date) ?? schedule.days[weekday];
    const unmatched = sessions.filter((s) => s.date === date);
    const items = plan.map((p): WeekItem => {
      const i = unmatched.findIndex((s) => s.sequenceId === p.sequenceId);
      const session = i === -1 ? null : unmatched.splice(i, 1)[0];
      return {
        sequenceId: p.sequenceId,
        name: nameOf(p.sequenceId),
        optional: !!p.optional,
        session: session && {
          id: session.id,
          finished: session.finished,
          word: session.word,
          done: session.done,
          total: session.total,
        },
      };
    });
    return {
      date,
      weekday,
      isToday: date === today,
      isPast: date < today,
      changed: dayPlans.has(date),
      items,
      extras: unmatched,
    };
  });

  // Progress for everything the schedule or a minimum mentions, in schedule order
  const ids: string[] = [];
  for (const items of schedule.days) {
    for (const item of items) if (!ids.includes(item.sequenceId)) ids.push(item.sequenceId);
  }
  for (const m of schedule.minimums) if (!ids.includes(m.sequenceId)) ids.push(m.sequenceId);

  const progress = ids
    .map((sequenceId): WeekProgress => ({
      sequenceId,
      name: nameOf(sequenceId),
      target: schedule.days.flat().filter((i) => i.sequenceId === sequenceId && !i.optional).length,
      done: sessions.filter((s) => s.sequenceId === sequenceId && s.finished).length,
      minimum: schedule.minimums.find((m) => m.sequenceId === sequenceId)?.perWeek ?? null,
    }))
    .filter((p) => p.target > 0 || p.minimum !== null);

  const withMinimum = progress.filter((p) => p.minimum !== null);
  return {
    start,
    end,
    days,
    progress,
    minimumMet: withMinimum.length ? withMinimum.every((p) => p.done >= p.minimum!) : null,
  };
}
