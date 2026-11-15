// Hero of the day: one cut-out face on the home page, a different hero each day.

export interface Hero {
  name: string;
  /** A head cut out of its background, with a white sticker edge (transparent PNG) */
  face: string;
}

export const HEROES: Hero[] = [
  { name: "Khabib", face: new URL("./heroes/khabib.png", import.meta.url).href },
  { name: "Honnold", face: new URL("./heroes/honnold.png", import.meta.url).href },
  { name: "Bruce Lee", face: new URL("./heroes/bruce-lee.png", import.meta.url).href },
  { name: "Arnold", face: new URL("./heroes/arnold.png", import.meta.url).href },
  { name: "Yung Chomsky", face: new URL("./heroes/yung-chomsky.png", import.meta.url).href },
  { name: "Bearistotle", face: new URL("./heroes/bearistotle.png", import.meta.url).href },
  { name: "Jeremy", face: new URL("./heroes/jeremy.png", import.meta.url).href },
  { name: "Lucas", face: new URL("./heroes/lucas.png", import.meta.url).href },
  { name: "Atlas", face: new URL("./heroes/atlas.png", import.meta.url).href },
  { name: "Ido", face: new URL("./heroes/ido.png", import.meta.url).href },
];

const STORAGE_KEY = "workout-hero-of-the-day";

/**
 * The same hero all day, a different one each day (local date). The day's pick is
 * remembered on this device, so adding heroes or a deploy doesn't swap it mid-day.
 */
export function heroOfTheDay(date: Date = new Date()): Hero | null {
  if (!HEROES.length) return null;
  const today = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { day: string; name: string } | null;
    const kept = saved?.day === today ? HEROES.find((h) => h.name === saved.name) : undefined;
    if (kept) return kept;
  } catch {
    // Storage can be unavailable (private mode); fall back to the date-based pick
  }
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  const hero = HEROES[day % HEROES.length];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: today, name: hero.name }));
  } catch {
    // Not remembered this time; still the same pick for the rest of the day unless the list changes
  }
  return hero;
}
