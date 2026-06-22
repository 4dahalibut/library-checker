import Database from "better-sqlite3";

const dbPath = process.env.CALENDAR_DATABASE_PATH || "data/calendar.db";
export const calendarDb = new Database(dbPath);

calendarDb.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT DEFAULT ''
  );
`);

// Seed all weeks and weekends of 2026 if table is empty
const count = calendarDb.prepare("SELECT COUNT(*) as c FROM entries").get() as { c: number };
if (count.c === 0) {
  const insert = calendarDb.prepare(
    "INSERT INTO entries (id, type, start_date, end_date, note) VALUES (?, ?, ?, ?, '')"
  );

  const seedAll = calendarDb.transaction(() => {
    // Walk through 2026 day by day, emitting week and weekend blocks
    // Weeks = Mon-Fri, Weekends = Sat-Sun
    const year = 2026;
    let d = new Date(year, 0, 1); // Jan 1, 2026 is a Thursday

    while (d.getFullYear() === year) {
      const day = d.getDay(); // 0=Sun, 1=Mon, ...6=Sat

      if (day === 6) {
        // Saturday - start of a weekend block (Sat-Sun)
        const sat = new Date(d);
        const sun = new Date(d);
        sun.setDate(sun.getDate() + 1);
        // If Sunday spills into next year, still include it
        const id = `weekend-${fmt(sat)}`;
        insert.run(id, "weekend", fmt(sat), fmt(sun));
        d.setDate(d.getDate() + 2); // skip to Monday
      } else if (day >= 1 && day <= 5) {
        // Weekday - find the Monday of this week
        const mon = new Date(d);
        mon.setDate(mon.getDate() - (day - 1));
        // Clamp to Jan 1 if Monday is in previous year
        if (mon.getFullYear() < year) mon.setTime(new Date(year, 0, 1).getTime());

        const fri = new Date(mon);
        fri.setDate(mon.getDate() + (4 - (mon.getDay() - 1)));
        // Clamp Friday to Dec 31 if it spills
        if (fri.getFullYear() > year) fri.setTime(new Date(year, 11, 31).getTime());

        const id = `week-${fmt(mon)}`;
        insert.run(id, "week", fmt(mon), fmt(fri));
        // Advance to Saturday
        d = new Date(fri);
        d.setDate(d.getDate() + 1);
      } else {
        // Sunday (day === 0) - just advance to Monday
        d.setDate(d.getDate() + 1);
      }
    }
  });

  seedAll();
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface CalendarEntry {
  id: string;
  type: string;
  start_date: string;
  end_date: string;
  note: string;
}

export function getAllEntries(): CalendarEntry[] {
  return calendarDb.prepare("SELECT * FROM entries ORDER BY start_date").all() as CalendarEntry[];
}

export function updateEntryNote(id: string, note: string): void {
  calendarDb.prepare("UPDATE entries SET note = ? WHERE id = ?").run(note, id);
}
