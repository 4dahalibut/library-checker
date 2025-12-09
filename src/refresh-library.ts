import { getBooksNeedingLibraryCheck, updateLibraryData, Book } from "./db.js";
import { searchByISBN, searchByTitleAuthor } from "./library.js";

const LIMIT = parseInt(process.argv[2] || "50", 10);
const OLDEST_FIRST = process.argv.includes("--oldest");
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processBook(book: Book, index: number, total: number): Promise<string> {
  let result = await searchByISBN(book.isbn13 || book.isbn);
  if (!result) {
    result = await searchByTitleAuthor(book.title, book.author);
  }

  const prefix = `[${index + 1}/${total}] ${book.title.substring(0, 50)}...`;

  if (result) {
    updateLibraryData(
      book.bookId,
      result.status,
      result.availableCopies,
      result.totalCopies,
      result.heldCopies,
      result.format,
      result.catalogUrl,
      result.squirrelHillAvailable
    );
    const icon = result.status === "AVAILABLE" ? "\x1b[32m✓\x1b[0m" : "\x1b[33m○\x1b[0m";
    const shIndicator = result.squirrelHillAvailable ? " \x1b[36m@SH\x1b[0m" : "";
    return `${prefix} ${icon} ${result.availableCopies}/${result.totalCopies}${shIndicator}`;
  } else {
    updateLibraryData(book.bookId, "NOT_FOUND", null, null, null, null, null, false);
    return `${prefix} \x1b[31m✗\x1b[0m not found`;
  }
}

async function main() {
  const books = getBooksNeedingLibraryCheck(LIMIT, OLDEST_FIRST);
  console.log(`Checking ${books.length} books${OLDEST_FIRST ? ' (oldest first)' : ''} with ${CONCURRENCY} concurrent requests...\n`);

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((book, j) => processBook(book, i + j, books.length))
    );
    results.forEach(r => console.log(r));

    if (i + CONCURRENCY < books.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
