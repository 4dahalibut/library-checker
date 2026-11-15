// Hero of the day: one face on the home page, rotating daily. Photos are freely
// licensed from Wikimedia Commons; their licenses ask for the credit shown with them.

export interface Hero {
  name: string;
  photo: string;
  /** Who took the photo and its license, e.g. "Photo: Jane Doe, CC BY 2.0" */
  credit: string;
  /** The photo's Commons page */
  source: string;
}

export const HEROES: Hero[] = [];

/** The same hero all day, a different one each day (local date) */
export function heroOfTheDay(date: Date = new Date()): Hero | null {
  if (!HEROES.length) return null;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return HEROES[day % HEROES.length];
}
