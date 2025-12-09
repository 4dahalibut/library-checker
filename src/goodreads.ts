import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import type { GoodreadsBook } from "./types.js";

export function loadGoodreadsCSV(filepath: string): GoodreadsBook[] {
  const content = readFileSync(filepath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  return records
    .filter((row) => row["Exclusive Shelf"] === "to-read")
    .map((row) => ({
      bookId: row["Book Id"],
      title: row["Title"],
      author: row["Author"],
      isbn: (row["ISBN"] || "").replace(/[="]/g, ""),
      isbn13: (row["ISBN13"] || "").replace(/[="]/g, ""),
      dateAdded: parseGoodreadsDate(row["Date Added"]),
      shelf: row["Exclusive Shelf"],
      avgRating: parseFloat(row["Average Rating"]) || 0,
      numRatings: undefined, // fetched separately from Goodreads
    }))
    .sort((a, b) => b.dateAdded.getTime() - a.dateAdded.getTime());
}

export async function fetchNumRatings(bookId: string): Promise<number> {
  try {
    const res = await fetch(`https://www.goodreads.com/book/show/${bookId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const html = await res.text();
    const match = html.match(/ratings">([0-9,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10);
    }
  } catch {
    // ignore
  }
  return 0;
}

function parseGoodreadsDate(dateStr: string): Date {
  // Format: 2025/12/06
  const [year, month, day] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}
