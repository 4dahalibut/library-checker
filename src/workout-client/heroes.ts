// Hero of the day: one cut-out face on the home page, a different hero each day.

export interface Hero {
  name: string;
  /** A head cut out of its background, with a white sticker edge (transparent PNG) */
  face: string;
}

export const HEROES: Hero[] = [
  { name: "Khabib Nurmagomedov", face: new URL("./heroes/khabib.png", import.meta.url).href },
];

/** The same hero all day, a different one each day (local date) */
export function heroOfTheDay(date: Date = new Date()): Hero | null {
  if (!HEROES.length) return null;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return HEROES[day % HEROES.length];
}
