import { readFileSync, writeFileSync } from "fs";
import { fetchNumRatings } from "./goodreads.js";
import type { CacheData } from "./types.js";

const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const cache: CacheData = JSON.parse(readFileSync("cache.json", "utf-8"));
  console.log(`Loaded ${cache.books.length} books from cache\n`);

  let fetched = 0;
  let skipped = 0;

  for (let i = 0; i < cache.books.length; i++) {
    const book = cache.books[i];
    const gr = book.goodreads;

    if (gr.numRatings !== undefined) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${cache.books.length}] Fetching: ${gr.title.substring(0, 50)}...`);

    const numRatings = await fetchNumRatings(gr.bookId);
    book.goodreads.numRatings = numRatings;
    fetched++;

    console.log(` ${numRatings.toLocaleString()} ratings`);

    await sleep(DELAY_MS);
  }

  // Save updated cache
  writeFileSync("cache.json", JSON.stringify(cache, null, 2));

  console.log(`\nDone! Fetched ${fetched}, skipped ${skipped} (already had ratings)`);
}

main().catch(console.error);
