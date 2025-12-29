import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import "dotenv/config";

const dbPath = process.env.DATABASE_PATH || "data/library.db";
const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    book_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    isbn TEXT,
    isbn13 TEXT,
    date_added TEXT,
    avg_rating REAL,
    num_ratings INTEGER,
    genres TEXT,

    -- Library data
    library_status TEXT,
    available_copies INTEGER,
    total_copies INTEGER,
    held_copies INTEGER,
    library_format TEXT,
    catalog_url TEXT,
    library_checked_at TEXT,
    squirrel_hill_available INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_date_added ON books(date_added DESC);
  CREATE INDEX IF NOT EXISTS idx_library_status ON books(library_status);
  CREATE INDEX IF NOT EXISTS idx_num_ratings ON books(num_ratings DESC);
`);

// Add genres column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN genres TEXT`);
} catch {
  // Column already exists
}

// Add squirrel_hill_available column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN squirrel_hill_available INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Add culture column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN culture TEXT`);
} catch {
  // Column already exists
}

// Add pinned column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN pinned INTEGER DEFAULT 0`);
} catch {
  // Column already exists
}

// Add publish_year column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN publish_year INTEGER`);
} catch {
  // Column already exists
}

// Add notes column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE books ADD COLUMN notes TEXT`);
} catch {
  // Column already exists
}

// Create recommendations table
db.exec(`
  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    recommended_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// Create finished books table
db.exec(`
  CREATE TABLE IF NOT EXISTS finished_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    rating INTEGER,
    review TEXT,
    finished_at TEXT NOT NULL,
    vibe TEXT
  )
`);

// Add vibe column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE finished_books ADD COLUMN vibe TEXT`);
} catch {
  // Column already exists
}

export interface Book {
  bookId: string;
  title: string;
  author: string;
  isbn: string;
  isbn13: string;
  dateAdded: string;
  avgRating: number | null;
  numRatings: number | null;
  genres: string | null;
  libraryStatus: string | null;
  availableCopies: number | null;
  totalCopies: number | null;
  heldCopies: number | null;
  libraryFormat: string | null;
  catalogUrl: string | null;
  libraryCheckedAt: string | null;
  squirrelHillAvailable: boolean;
  culture: string | null;
  pinned: boolean;
  publishYear: number | null;
  notes: string | null;
}

export function importGoodreadsCSV(filepath: string): number {
  const content = readFileSync(filepath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO books (book_id, title, author, isbn, isbn13, date_added, avg_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const toReadBooks = records.filter((row) => row["Exclusive Shelf"] === "to-read");

  const tx = db.transaction(() => {
    for (const row of toReadBooks) {
      insert.run(
        row["Book Id"],
        row["Title"],
        row["Author"],
        (row["ISBN"] || "").replace(/[="]/g, ""),
        (row["ISBN13"] || "").replace(/[="]/g, ""),
        row["Date Added"],
        parseFloat(row["Average Rating"]) || null
      );
    }
  });

  tx();
  return toReadBooks.length;
}

export function getAllBooks(): Book[] {
  const rows = db.prepare(`
    SELECT
      book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
      avg_rating as avgRating, num_ratings as numRatings, genres,
      library_status as libraryStatus, available_copies as availableCopies,
      total_copies as totalCopies, held_copies as heldCopies,
      library_format as libraryFormat, catalog_url as catalogUrl,
      library_checked_at as libraryCheckedAt,
      squirrel_hill_available as squirrelHillAvailable,
      culture,
      pinned,
      publish_year as publishYear,
      notes
    FROM books
    ORDER BY date_added DESC
  `).all() as Book[];
  return rows;
}

export function getBooksNeedingLibraryCheck(limit: number, oldestFirst = false): Book[] {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const order = oldestFirst ? 'ASC' : 'DESC';
  const rows = db.prepare(`
    SELECT
      book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
      avg_rating as avgRating, num_ratings as numRatings,
      library_status as libraryStatus, available_copies as availableCopies,
      total_copies as totalCopies, held_copies as heldCopies,
      library_format as libraryFormat, catalog_url as catalogUrl,
      library_checked_at as libraryCheckedAt
    FROM books
    WHERE library_checked_at IS NULL OR library_checked_at < ?
    ORDER BY date_added ${order}
    LIMIT ?
  `).all(oneDayAgo, limit) as Book[];
  return rows;
}

export function getBooksNeedingRatings(limit: number): Book[] {
  const rows = db.prepare(`
    SELECT
      book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
      avg_rating as avgRating, num_ratings as numRatings,
      library_status as libraryStatus, available_copies as availableCopies,
      total_copies as totalCopies, held_copies as heldCopies,
      library_format as libraryFormat, catalog_url as catalogUrl,
      library_checked_at as libraryCheckedAt
    FROM books
    WHERE num_ratings IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as Book[];
  return rows;
}

export function updateLibraryData(
  bookId: string,
  status: string | null,
  availableCopies: number | null,
  totalCopies: number | null,
  heldCopies: number | null,
  format: string | null,
  catalogUrl: string | null,
  squirrelHillAvailable: boolean
): void {
  db.prepare(`
    UPDATE books SET
      library_status = ?,
      available_copies = ?,
      total_copies = ?,
      held_copies = ?,
      library_format = ?,
      catalog_url = ?,
      library_checked_at = ?,
      squirrel_hill_available = ?
    WHERE book_id = ?
  `).run(status, availableCopies, totalCopies, heldCopies, format, catalogUrl, new Date().toISOString(), squirrelHillAvailable ? 1 : 0, bookId);
}

export function updateNumRatings(bookId: string, numRatings: number): void {
  db.prepare(`UPDATE books SET num_ratings = ? WHERE book_id = ?`).run(numRatings, bookId);
}

export function updateGenres(bookId: string, genres: string[]): void {
  db.prepare(`UPDATE books SET genres = ? WHERE book_id = ?`).run(JSON.stringify(genres), bookId);
}

export function updateCulture(bookId: string, culture: string): void {
  db.prepare(`UPDATE books SET culture = ? WHERE book_id = ?`).run(culture, bookId);
}

export function updateNotes(bookId: string, notes: string): void {
  db.prepare(`UPDATE books SET notes = ? WHERE book_id = ?`).run(notes || null, bookId);
}

export function getBooksNeedingCulture(limit: number): Book[] {
  const rows = db.prepare(`
    SELECT
      book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
      avg_rating as avgRating, num_ratings as numRatings, genres,
      library_status as libraryStatus, available_copies as availableCopies,
      total_copies as totalCopies, held_copies as heldCopies,
      library_format as libraryFormat, catalog_url as catalogUrl,
      library_checked_at as libraryCheckedAt,
      squirrel_hill_available as squirrelHillAvailable,
      culture,
      publish_year as publishYear
    FROM books
    WHERE culture IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as Book[];
  return rows;
}

export function getBooksNeedingGenres(limit: number): Book[] {
  const rows = db.prepare(`
    SELECT
      book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
      avg_rating as avgRating, num_ratings as numRatings, genres,
      library_status as libraryStatus, available_copies as availableCopies,
      total_copies as totalCopies, held_copies as heldCopies,
      library_format as libraryFormat, catalog_url as catalogUrl,
      library_checked_at as libraryCheckedAt
    FROM books
    WHERE genres IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as Book[];
  return rows;
}

export function getAllGenres(): { genre: string; count: number }[] {
  const books = db.prepare(`SELECT genres FROM books WHERE genres IS NOT NULL`).all() as { genres: string }[];
  const genreCounts = new Map<string, number>();

  for (const book of books) {
    const genres = JSON.parse(book.genres) as string[];
    for (const genre of genres) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }

  return [...genreCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count);
}

export function addBook(book: {
  bookId: string;
  title: string;
  author: string;
  isbn?: string;
  isbn13?: string;
  publishYear?: number;
}): void {
  const now = new Date();
  const dateAdded = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  db.prepare(`
    INSERT OR IGNORE INTO books (book_id, title, author, isbn, isbn13, date_added, publish_year)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(book.bookId, book.title, book.author, book.isbn || null, book.isbn13 || null, dateAdded, book.publishYear || null);
}

export function deleteBook(bookId: string): void {
  db.prepare(`DELETE FROM books WHERE book_id = ?`).run(bookId);
}

export function togglePin(bookId: string): boolean {
  const book = db.prepare(`SELECT pinned FROM books WHERE book_id = ?`).get(bookId) as { pinned: number } | undefined;
  const newPinned = book?.pinned ? 0 : 1;
  db.prepare(`UPDATE books SET pinned = ? WHERE book_id = ?`).run(newPinned, bookId);
  return newPinned === 1;
}

export function getStats() {
  const total = db.prepare(`SELECT COUNT(*) as count FROM books`).get() as { count: number };
  const available = db.prepare(`SELECT COUNT(*) as count FROM books WHERE library_status = 'AVAILABLE'`).get() as { count: number };
  const unavailable = db.prepare(`SELECT COUNT(*) as count FROM books WHERE library_status = 'UNAVAILABLE'`).get() as { count: number };
  const notFound = db.prepare(`SELECT COUNT(*) as count FROM books WHERE library_status = 'NOT_FOUND'`).get() as { count: number };
  const unchecked = db.prepare(`SELECT COUNT(*) as count FROM books WHERE library_status IS NULL`).get() as { count: number };

  return {
    total: total.count,
    available: available.count,
    unavailable: unavailable.count,
    notFound: notFound.count,
    unchecked: unchecked.count,
  };
}

// Recommendations
export interface Recommendation {
  id: number;
  title: string;
  author: string | null;
  recommendedBy: string;
  createdAt: string;
}

export function getRecommendations(): Recommendation[] {
  return db.prepare(`
    SELECT id, title, author, recommended_by as recommendedBy, created_at as createdAt
    FROM recommendations
    ORDER BY created_at DESC
  `).all() as Recommendation[];
}

export function addRecommendation(title: string, author: string | null, recommendedBy: string): Recommendation {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO recommendations (title, author, recommended_by, created_at)
    VALUES (?, ?, ?, ?)
  `).run(title, author, recommendedBy, createdAt);

  return {
    id: result.lastInsertRowid as number,
    title,
    author,
    recommendedBy,
    createdAt,
  };
}

export function deleteRecommendation(id: number): void {
  db.prepare(`DELETE FROM recommendations WHERE id = ?`).run(id);
}

// Finished Books
export interface FinishedBook {
  id: number;
  title: string;
  author: string | null;
  vibe: string | null;
  review: string | null;
  finishedAt: string;
}

export function getFinishedBooks(): FinishedBook[] {
  return db.prepare(`
    SELECT id, title, author, vibe, review, finished_at as finishedAt
    FROM finished_books
    ORDER BY finished_at DESC
  `).all() as FinishedBook[];
}

export function addFinishedBook(title: string, author: string | null, vibe: string | null, review: string | null): FinishedBook {
  const finishedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO finished_books (title, author, vibe, review, finished_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, author, vibe, review, finishedAt);

  return {
    id: result.lastInsertRowid as number,
    title,
    author,
    vibe,
    review,
    finishedAt,
  };
}

export function updateFinishedBook(id: number, vibe: string | null, review: string | null): void {
  db.prepare(`UPDATE finished_books SET vibe = ?, review = ? WHERE id = ?`).run(vibe, review, id);
}

export function deleteFinishedBook(id: number): void {
  db.prepare(`DELETE FROM finished_books WHERE id = ?`).run(id);
}

export { db };
