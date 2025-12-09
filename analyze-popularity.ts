import { readFileSync } from "fs";
import type { CacheData } from "./src/types.js";

const cache: CacheData = JSON.parse(readFileSync("cache.json", "utf-8"));

// Get books not in library
const notInLibrary = cache.books
  .filter(b => !b.library)
  .map(b => ({
    title: b.goodreads.title,
    author: b.goodreads.author,
    bookId: b.goodreads.bookId,
  }));

// Get books that ARE in library
const inLibrary = cache.books
  .filter(b => b.library)
  .map(b => ({
    title: b.goodreads.title,
    author: b.goodreads.author,
    bookId: b.goodreads.bookId,
  }));

async function fetchRatingCount(bookId: string): Promise<number> {
  try {
    const res = await fetch(`https://www.goodreads.com/book/show/${bookId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
    });
    const html = await res.text();
    // Look for pattern like: ratings">1,562
    const match = html.match(/ratings">([0-9,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10);
    }
  } catch (e) {
    // ignore
  }
  return 0;
}

async function main() {
  console.log("Fetching rating counts from Goodreads...\n");

  // Sample: fetch for missing books
  const missingWithRatings: { title: string; author: string; ratings: number }[] = [];

  for (let i = 0; i < Math.min(notInLibrary.length, 71); i++) {
    const book = notInLibrary[i];
    const ratings = await fetchRatingCount(book.bookId);
    missingWithRatings.push({ title: book.title, author: book.author, ratings });
    process.stdout.write(`\r[${i + 1}/${Math.min(notInLibrary.length, 71)}] Fetched ${book.title.substring(0, 30)}...`);
    await new Promise(r => setTimeout(r, 200)); // be nice
  }

  console.log("\n");

  // Sort by rating count descending
  missingWithRatings.sort((a, b) => b.ratings - a.ratings);

  console.log("=".repeat(70));
  console.log("MOST POPULAR BOOKS (by # of ratings) NOT IN LIBRARY");
  console.log("=".repeat(70));
  console.log();

  missingWithRatings.slice(0, 25).forEach((b, i) => {
    const ratingStr = b.ratings.toLocaleString().padStart(8);
    console.log(`${(i + 1).toString().padStart(2)}. ${ratingStr} ratings | ${b.title.substring(0, 45)}`);
    console.log(`                      by ${b.author}`);
  });

  const totalMissingRatings = missingWithRatings.reduce((s, b) => s + b.ratings, 0);
  console.log();
  console.log(`Total ratings across missing books: ${totalMissingRatings.toLocaleString()}`);
  console.log(`Average ratings per missing book: ${Math.round(totalMissingRatings / missingWithRatings.length).toLocaleString()}`);
}

main();
