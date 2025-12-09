import { getBooksNeedingLibraryCheck, updateLibraryData } from "./db.js";
import { searchByISBN, searchByTitleAuthor } from "./library.js";

const LIMIT = parseInt(process.argv[2] || "50", 10);
const OLDEST_FIRST = process.argv.includes("--oldest");
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const books = getBooksNeedingLibraryCheck(LIMIT, OLDEST_FIRST);
  console.log(`Checking library availability for ${books.length} books${OLDEST_FIRST ? ' (oldest first)' : ''}...\n`);

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    process.stdout.write(`[${i + 1}/${books.length}] ${book.title.substring(0, 50)}... `);

    let result = await searchByISBN(book.isbn13 || book.isbn);
    if (!result) {
      result = await searchByTitleAuthor(book.title, book.author);
    }

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
      console.log(`${icon} ${result.availableCopies}/${result.totalCopies}${shIndicator}`);
    } else {
      updateLibraryData(book.bookId, "NOT_FOUND", null, null, null, null, null, false);
      console.log("\x1b[31m✗\x1b[0m not found");
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone!");
}

main().catch(console.error);
