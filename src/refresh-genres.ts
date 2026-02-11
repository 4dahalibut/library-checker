import { getAllBooksNeedingGenres, updateGenres } from "./db.js";

const LIMIT = parseInt(process.argv[2] || "100", 10);
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGenres(bookId: string): Promise<string[]> {
  try {
    const res = await fetch(`https://www.goodreads.com/book/show/${bookId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const html = await res.text();
    const matches = html.matchAll(/genres\/([a-z-]+)/g);
    const genres = new Set<string>();
    for (const match of matches) {
      genres.add(match[1]);
    }
    return [...genres];
  } catch {
    return [];
  }
}

async function main() {
  const books = getAllBooksNeedingGenres(LIMIT);
  console.log(`Fetching genres for ${books.length} books...\n`);

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    process.stdout.write(`[${i + 1}/${books.length}] ${book.title.substring(0, 45)}... `);

    const genres = await fetchGenres(book.bookId);
    updateGenres(book.userId, book.bookId, genres);

    if (genres.length > 0) {
      console.log(genres.slice(0, 5).join(", "));
    } else {
      console.log("(no genres)");
    }

    await sleep(DELAY_MS);
  }

  console.log("\nDone!");
}

main().catch(console.error);
