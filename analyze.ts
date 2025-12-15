import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import type { CacheData } from "./src/types.js";

// Load cache
const cache: CacheData = JSON.parse(readFileSync("cache.json", "utf-8"));

// Load Goodreads CSV to get ratings
const csvContent = readFileSync("data/goodreads_library_export.csv", "utf-8");
const records = parse(csvContent, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

// Create a map of book ID to average rating
const ratingMap = new Map<string, number>();
for (const row of records) {
  const bookId = row["Book Id"];
  const avgRating = parseFloat(row["Average Rating"]) || 0;
  ratingMap.set(bookId, avgRating);
}

// Find books not in library, sorted by Goodreads average rating
const notInLibrary = cache.books
  .filter(b => !b.library)
  .map(b => ({
    title: b.goodreads.title,
    author: b.goodreads.author,
    bookId: b.goodreads.bookId,
    avgRating: ratingMap.get(b.goodreads.bookId) || 0,
  }))
  .sort((a, b) => b.avgRating - a.avgRating);

console.log("=".repeat(70));
console.log("MOST POPULAR BOOKS NOT IN CARNEGIE LIBRARY");
console.log("(sorted by Goodreads average rating)");
console.log("=".repeat(70));
console.log();

notInLibrary.slice(0, 25).forEach((b, i) => {
  console.log(`${i + 1}. [${b.avgRating.toFixed(2)}] ${b.title.substring(0, 55)}`);
  console.log(`   by ${b.author}`);
});

console.log();
console.log("=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log(`Total books checked: ${cache.books.length}`);
console.log(`Not in library: ${notInLibrary.length}`);
console.log(`Average rating of missing books: ${(notInLibrary.reduce((s, b) => s + b.avgRating, 0) / notInLibrary.length).toFixed(2)}`);

// Books that ARE available, sorted by rating
const available = cache.books
  .filter(b => b.library?.status === "AVAILABLE")
  .map(b => ({
    title: b.goodreads.title,
    avgRating: ratingMap.get(b.goodreads.bookId) || 0,
  }))
  .sort((a, b) => b.avgRating - a.avgRating);

console.log(`Average rating of available books: ${(available.reduce((s, b) => s + b.avgRating, 0) / available.length).toFixed(2)}`);
