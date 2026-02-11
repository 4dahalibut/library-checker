import { getAllBooksNeedingRatings, updateNumRatings } from "./db.js";
import { fetchNumRatings } from "./goodreads.js";

const LIMIT = parseInt(process.argv[2] || "100", 10);
const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const books = getAllBooksNeedingRatings(LIMIT);
  console.log(`Fetching Goodreads ratings for ${books.length} books...\n`);

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    process.stdout.write(`[${i + 1}/${books.length}] ${book.title.substring(0, 50)}... `);

    const numRatings = await fetchNumRatings(book.bookId);
    updateNumRatings(book.userId, book.bookId, numRatings);
    console.log(`${numRatings.toLocaleString()} ratings`);

    await sleep(DELAY_MS);
  }

  console.log("\nDone!");
}

main().catch(console.error);
