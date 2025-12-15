import Database from "better-sqlite3";

const db = new Database("data/library.db");

const LIMIT = parseInt(process.argv[2] || "50");
const DELAY_MS = 200;

interface Book {
  book_id: string;
  title: string;
  author: string;
  isbn13: string | null;
}

function cleanTitle(title: string): string {
  // Remove subtitle after colon and anything in parentheses
  return title
    .split(":")[0]
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
}

async function fetchPublishYear(title: string, author: string): Promise<number | null> {
  const cleanedTitle = cleanTitle(title);
  const query = encodeURIComponent(`${cleanedTitle} ${author.split(",")[0]}`);
  const url = `https://openlibrary.org/search.json?q=${query}&limit=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.docs?.[0]?.first_publish_year) {
      return data.docs[0].first_publish_year;
    }
  } catch (e) {
    console.error(`  Error fetching: ${e}`);
  }
  return null;
}

async function main() {
  const books = db
    .prepare(
      `SELECT book_id, title, author, isbn13
       FROM books
       WHERE publish_year IS NULL
       ORDER BY date_added DESC
       LIMIT ?`
    )
    .all(LIMIT) as Book[];

  console.log(`Fetching publish years for ${books.length} books...\n`);

  const stmt = db.prepare("UPDATE books SET publish_year = ? WHERE book_id = ?");
  let found = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const year = await fetchPublishYear(book.title, book.author);

    if (year) {
      stmt.run(year, book.book_id);
      console.log(`${i + 1}/${books.length} [${year}] ${book.title}`);
      found++;
    } else {
      console.log(`${i + 1}/${books.length} [????] ${book.title}`);
    }

    if (i < books.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\nDone. Found years for ${found}/${books.length} books.`);
}

main();
