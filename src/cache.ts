import { readFileSync, writeFileSync, existsSync } from "fs";
import type { BookWithAvailability, CacheData } from "./types.js";

const CACHE_FILE = "cache.json";

export function loadCache(): CacheData | null {
  if (!existsSync(CACHE_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(CACHE_FILE, "utf-8");
    const data = JSON.parse(content) as CacheData;
    // Rehydrate dates
    data.books = data.books.map((b) => ({
      ...b,
      goodreads: {
        ...b.goodreads,
        dateAdded: new Date(b.goodreads.dateAdded),
      },
      lastChecked: new Date(b.lastChecked),
    }));
    return data;
  } catch {
    return null;
  }
}

export function saveCache(data: CacheData): void {
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

export function getCachedBook(
  cache: CacheData | null,
  bookId: string
): BookWithAvailability | undefined {
  return cache?.books.find((b) => b.goodreads.bookId === bookId);
}
