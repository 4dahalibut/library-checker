import { getAllBooksNeedingPublishYears, updatePublishYear } from "./db.js";

const LIMIT = parseInt(process.argv[2] || "50");
const DELAY_MS = 200;

function cleanTitle(title: string): string {
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
  const books = getAllBooksNeedingPublishYears(LIMIT);
  console.log(`Fetching publish years for ${books.length} books...\n`);

  let found = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const year = await fetchPublishYear(book.title, book.author);

    if (year) {
      updatePublishYear(book.userId, book.bookId, year);
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
