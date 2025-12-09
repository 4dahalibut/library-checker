import { loadGoodreadsCSV, fetchNumRatings } from "./goodreads.js";
import { searchByISBN, searchByTitleAuthor } from "./library.js";
import { loadCache, saveCache, getCachedBook } from "./cache.js";
import type { BookWithAvailability, CacheData } from "./types.js";

const CSV_FILE = process.argv[2] || "goodreads_library_export.csv";
const LIMIT = parseInt(process.argv[3] || "50", 10);
const DELAY_MS = 300; // Be nice to the API

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Loading books from ${CSV_FILE}...`);
  const goodreadsBooks = loadGoodreadsCSV(CSV_FILE);
  console.log(`Found ${goodreadsBooks.length} books on 'Want to Read' shelf`);

  const booksToCheck = goodreadsBooks.slice(0, LIMIT);
  console.log(`Checking ${booksToCheck.length} most recent books...\n`);

  const existingCache = loadCache();
  const results: BookWithAvailability[] = [];

  // Keep cached results for books we're not checking this run
  const uncheckedBooks = goodreadsBooks.slice(LIMIT);
  for (const book of uncheckedBooks) {
    const cached = getCachedBook(existingCache, book.bookId);
    if (cached) {
      results.push(cached);
    }
  }

  for (let i = 0; i < booksToCheck.length; i++) {
    const book = booksToCheck[i];
    const progress = `[${i + 1}/${booksToCheck.length}]`;

    // Check if we have recent cache (less than 24 hours old)
    const cached = getCachedBook(existingCache, book.bookId);
    const cacheAge = cached
      ? Date.now() - new Date(cached.lastChecked).getTime()
      : Infinity;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (cached && cacheAge < ONE_DAY) {
      console.log(`${progress} ${book.title} - using cache`);
      results.push(cached);
      continue;
    }

    console.log(`${progress} Searching: ${book.title} by ${book.author}...`);

    // Try ISBN first, then title+author
    let library = await searchByISBN(book.isbn13 || book.isbn);
    if (!library) {
      library = await searchByTitleAuthor(book.title, book.author);
    }

    if (library) {
      const statusIcon =
        library.status === "AVAILABLE"
          ? "\x1b[32m✓\x1b[0m"
          : "\x1b[33m○\x1b[0m";
      console.log(
        `  ${statusIcon} ${library.status} (${library.availableCopies}/${library.totalCopies} available, ${library.heldCopies} holds)`
      );
    } else {
      console.log("  \x1b[31m✗\x1b[0m Not found in catalog");
    }

    // Fetch numRatings from Goodreads if we don't have it cached
    let numRatings = cached?.goodreads.numRatings;
    if (numRatings === undefined) {
      numRatings = await fetchNumRatings(book.bookId);
      await sleep(200); // extra delay for Goodreads
    }

    results.push({
      goodreads: { ...book, numRatings },
      library,
      lastChecked: new Date(),
    });

    await sleep(DELAY_MS);
  }

  // Save cache
  const cacheData: CacheData = {
    books: results,
    lastRefresh: new Date().toISOString(),
  };
  saveCache(cacheData);

  // Summary
  const available = results.filter(
    (r) => r.library?.status === "AVAILABLE"
  ).length;
  const unavailable = results.filter(
    (r) => r.library && r.library.status !== "AVAILABLE"
  ).length;
  const notFound = results.filter((r) => !r.library).length;

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Available now: ${available}`);
  console.log(`In catalog but unavailable: ${unavailable}`);
  console.log(`Not found: ${notFound}`);
  console.log(`\nResults saved to cache.json`);
  console.log(`Run 'npm run dev' to start the web UI`);
}

main().catch(console.error);
