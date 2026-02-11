import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { scryptSync, randomBytes } from "crypto";
import "dotenv/config";

const dbPath = process.env.DATABASE_PATH || "data/library.db";
const db = new Database(dbPath);

// Initialize schema - users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

// --- Migration: detect old schema and migrate ---
function checkAndMigrateOldSchema() {
  const columns = db.prepare(`PRAGMA table_info(books)`).all() as { name: string; pk: number }[];
  if (columns.length === 0) return; // Table doesn't exist yet

  const hasUserId = columns.some(c => c.name === "user_id");
  if (hasUserId) return; // Already migrated

  // Old schema detected - need to migrate
  console.log("Migrating database to multi-user schema...");

  // Add old columns that might be missing
  const colNames = new Set(columns.map(c => c.name));
  const addColIfMissing = (table: string, col: string, type: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* exists */ }
  };
  if (!colNames.has("genres")) addColIfMissing("books", "genres", "TEXT");
  if (!colNames.has("squirrel_hill_available")) addColIfMissing("books", "squirrel_hill_available", "INTEGER DEFAULT 0");
  if (!colNames.has("culture")) addColIfMissing("books", "culture", "TEXT");
  if (!colNames.has("pinned")) addColIfMissing("books", "pinned", "INTEGER DEFAULT 0");
  if (!colNames.has("publish_year")) addColIfMissing("books", "publish_year", "INTEGER");
  if (!colNames.has("notes")) addColIfMissing("books", "notes", "TEXT");
  try { db.exec(`ALTER TABLE finished_books ADD COLUMN vibe TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN library_barcode TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN library_pin TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN library_account_id TEXT`); } catch { /* exists */ }

  const tx = db.transaction(() => {
    // Create josh user with hashed password
    const password = process.env.AUTH_PASSWORD || "12327791";
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const passwordHash = `${salt}:${hash}`;

    db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`).run(
      "josh", passwordHash, new Date().toISOString()
    );
    const joshUser = db.prepare(`SELECT id FROM users WHERE username = ?`).get("josh") as { id: number };
    const joshId = joshUser.id;

    // Migrate books
    db.exec(`CREATE TABLE books_new (
      user_id INTEGER NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      isbn TEXT,
      isbn13 TEXT,
      date_added TEXT,
      avg_rating REAL,
      num_ratings INTEGER,
      genres TEXT,
      library_status TEXT,
      available_copies INTEGER,
      total_copies INTEGER,
      held_copies INTEGER,
      library_format TEXT,
      catalog_url TEXT,
      library_checked_at TEXT,
      squirrel_hill_available INTEGER DEFAULT 0,
      culture TEXT,
      pinned INTEGER DEFAULT 0,
      publish_year INTEGER,
      notes TEXT,
      PRIMARY KEY (user_id, book_id)
    )`);
    db.prepare(`INSERT INTO books_new SELECT ?, book_id, title, author, isbn, isbn13, date_added, avg_rating, num_ratings, genres, library_status, available_copies, total_copies, held_copies, library_format, catalog_url, library_checked_at, squirrel_hill_available, culture, pinned, publish_year, notes FROM books`).run(joshId);
    db.exec(`DROP TABLE books`);
    db.exec(`ALTER TABLE books_new RENAME TO books`);

    // Migrate recommendations
    const recCols = db.prepare(`PRAGMA table_info(recommendations)`).all() as { name: string }[];
    if (!recCols.some(c => c.name === "user_id")) {
      db.exec(`CREATE TABLE recommendations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        recommended_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      db.prepare(`INSERT INTO recommendations_new (user_id, id, title, author, recommended_by, created_at) SELECT ?, id, title, author, recommended_by, created_at FROM recommendations`).run(joshId);
      db.exec(`DROP TABLE recommendations`);
      db.exec(`ALTER TABLE recommendations_new RENAME TO recommendations`);
    }

    // Migrate finished_books
    const finCols = db.prepare(`PRAGMA table_info(finished_books)`).all() as { name: string }[];
    if (!finCols.some(c => c.name === "user_id")) {
      db.exec(`CREATE TABLE finished_books_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        rating INTEGER,
        review TEXT,
        finished_at TEXT NOT NULL,
        vibe TEXT
      )`);
      db.prepare(`INSERT INTO finished_books_new (user_id, id, title, author, rating, review, finished_at, vibe) SELECT ?, id, title, author, rating, review, finished_at, vibe FROM finished_books`).run(joshId);
      db.exec(`DROP TABLE finished_books`);
      db.exec(`ALTER TABLE finished_books_new RENAME TO finished_books`);
    }

    // Delete all existing sessions (force re-login)
    try { db.exec(`DELETE FROM sessions`); } catch { /* table may not exist yet */ }

    // Recreate indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_date_added ON books(date_added DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_library_status ON books(library_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_num_ratings ON books(num_ratings DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id)`);
  });

  tx();
  console.log("Migration complete!");
}

checkAndMigrateOldSchema();

// Migrate library credentials for josh from env vars
try { db.exec(`ALTER TABLE users ADD COLUMN library_barcode TEXT`); } catch { /* exists */ }
try { db.exec(`ALTER TABLE users ADD COLUMN library_pin TEXT`); } catch { /* exists */ }
try { db.exec(`ALTER TABLE users ADD COLUMN library_account_id TEXT`); } catch { /* exists */ }

if (process.env.LIBRARY_BARCODE && process.env.LIBRARY_PIN && process.env.LIBRARY_ACCOUNT_ID) {
  db.prepare(`UPDATE users SET library_barcode = ?, library_pin = ?, library_account_id = ? WHERE username = 'josh' AND library_barcode IS NULL`)
    .run(process.env.LIBRARY_BARCODE, process.env.LIBRARY_PIN, process.env.LIBRARY_ACCOUNT_ID);
}

// Create tables for fresh installs (no-op if they exist from migration)
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    user_id INTEGER NOT NULL,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    isbn TEXT,
    isbn13 TEXT,
    date_added TEXT,
    avg_rating REAL,
    num_ratings INTEGER,
    genres TEXT,
    library_status TEXT,
    available_copies INTEGER,
    total_copies INTEGER,
    held_copies INTEGER,
    library_format TEXT,
    catalog_url TEXT,
    library_checked_at TEXT,
    squirrel_hill_available INTEGER DEFAULT 0,
    culture TEXT,
    pinned INTEGER DEFAULT 0,
    publish_year INTEGER,
    notes TEXT,
    PRIMARY KEY (user_id, book_id)
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_date_added ON books(date_added DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_library_status ON books(library_status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_num_ratings ON books(num_ratings DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    recommended_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS finished_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    rating INTEGER,
    review TEXT,
    finished_at TEXT NOT NULL,
    vibe TEXT
  )
`);

// --- Interfaces ---

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

export interface BookWithUser extends Book {
  userId: number;
}

export interface Recommendation {
  id: number;
  title: string;
  author: string | null;
  recommendedBy: string;
  createdAt: string;
}

export interface FinishedBook {
  id: number;
  title: string;
  author: string | null;
  vibe: string | null;
  review: string | null;
  finishedAt: string;
}

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
  libraryBarcode: string | null;
  libraryPin: string | null;
  libraryAccountId: string | null;
}

// --- User management ---

export function getUserByUsername(username: string): User | null {
  const row = db.prepare(`SELECT id, username, password_hash as passwordHash, created_at as createdAt, library_barcode as libraryBarcode, library_pin as libraryPin, library_account_id as libraryAccountId FROM users WHERE username = ?`).get(username) as User | undefined;
  return row || null;
}

export function getUserById(id: number): User | null {
  const row = db.prepare(`SELECT id, username, password_hash as passwordHash, created_at as createdAt, library_barcode as libraryBarcode, library_pin as libraryPin, library_account_id as libraryAccountId FROM users WHERE id = ?`).get(id) as User | undefined;
  return row || null;
}

export function createUser(username: string, passwordHash: string, libraryBarcode: string | null = null, libraryPin: string | null = null, libraryAccountId: string | null = null): User {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`INSERT INTO users (username, password_hash, created_at, library_barcode, library_pin, library_account_id) VALUES (?, ?, ?, ?, ?, ?)`).run(username, passwordHash, createdAt, libraryBarcode, libraryPin, libraryAccountId);
  return { id: result.lastInsertRowid as number, username, passwordHash, createdAt, libraryBarcode, libraryPin, libraryAccountId };
}

// --- Book queries (user-scoped) ---

const BOOK_SELECT = `
  book_id as bookId, title, author, isbn, isbn13, date_added as dateAdded,
  avg_rating as avgRating, num_ratings as numRatings, genres,
  library_status as libraryStatus, available_copies as availableCopies,
  total_copies as totalCopies, held_copies as heldCopies,
  library_format as libraryFormat, catalog_url as catalogUrl,
  library_checked_at as libraryCheckedAt,
  squirrel_hill_available as squirrelHillAvailable,
  culture, pinned, publish_year as publishYear, notes
`;

export function getAllBooks(userId: number): Book[] {
  return db.prepare(`SELECT ${BOOK_SELECT} FROM books WHERE user_id = ? ORDER BY date_added DESC`).all(userId) as Book[];
}

export function getStats(userId: number) {
  const total = db.prepare(`SELECT COUNT(*) as count FROM books WHERE user_id = ?`).get(userId) as { count: number };
  const available = db.prepare(`SELECT COUNT(*) as count FROM books WHERE user_id = ? AND library_status = 'AVAILABLE'`).get(userId) as { count: number };
  const unavailable = db.prepare(`SELECT COUNT(*) as count FROM books WHERE user_id = ? AND library_status = 'UNAVAILABLE'`).get(userId) as { count: number };
  const notFound = db.prepare(`SELECT COUNT(*) as count FROM books WHERE user_id = ? AND library_status = 'NOT_FOUND'`).get(userId) as { count: number };
  const unchecked = db.prepare(`SELECT COUNT(*) as count FROM books WHERE user_id = ? AND library_status IS NULL`).get(userId) as { count: number };

  return {
    total: total.count,
    available: available.count,
    unavailable: unavailable.count,
    notFound: notFound.count,
    unchecked: unchecked.count,
  };
}

export function getAllGenres(userId: number): { genre: string; count: number }[] {
  const books = db.prepare(`SELECT genres FROM books WHERE user_id = ? AND genres IS NOT NULL`).all(userId) as { genres: string }[];
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

export function addBook(params: {
  userId: number;
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
    INSERT OR IGNORE INTO books (user_id, book_id, title, author, isbn, isbn13, date_added, publish_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.userId, params.bookId, params.title, params.author, params.isbn || null, params.isbn13 || null, dateAdded, params.publishYear || null);
}

export function deleteBook(userId: number, bookId: string): void {
  db.prepare(`DELETE FROM books WHERE user_id = ? AND book_id = ?`).run(userId, bookId);
}

export function togglePin(userId: number, bookId: string): boolean {
  const book = db.prepare(`SELECT pinned FROM books WHERE user_id = ? AND book_id = ?`).get(userId, bookId) as { pinned: number } | undefined;
  const newPinned = book?.pinned ? 0 : 1;
  db.prepare(`UPDATE books SET pinned = ? WHERE user_id = ? AND book_id = ?`).run(newPinned, userId, bookId);
  return newPinned === 1;
}

export function updateNotes(userId: number, bookId: string, notes: string): void {
  db.prepare(`UPDATE books SET notes = ? WHERE user_id = ? AND book_id = ?`).run(notes || null, userId, bookId);
}

export function updateLibraryData(
  userId: number,
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
    WHERE user_id = ? AND book_id = ?
  `).run(status, availableCopies, totalCopies, heldCopies, format, catalogUrl, new Date().toISOString(), squirrelHillAvailable ? 1 : 0, userId, bookId);
}

export function updateNumRatings(userId: number, bookId: string, numRatings: number): void {
  db.prepare(`UPDATE books SET num_ratings = ? WHERE user_id = ? AND book_id = ?`).run(numRatings, userId, bookId);
}

export function updateGenres(userId: number, bookId: string, genres: string[]): void {
  db.prepare(`UPDATE books SET genres = ? WHERE user_id = ? AND book_id = ?`).run(JSON.stringify(genres), userId, bookId);
}

export function updateCulture(userId: number, bookId: string, culture: string): void {
  db.prepare(`UPDATE books SET culture = ? WHERE user_id = ? AND book_id = ?`).run(culture, userId, bookId);
}

// --- Cross-user queries for refresh scripts ---

export function getAllBooksNeedingLibraryCheck(limit: number, oldestFirst = false): BookWithUser[] {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const order = oldestFirst ? 'ASC' : 'DESC';
  return db.prepare(`
    SELECT user_id as userId, ${BOOK_SELECT}
    FROM books
    WHERE library_checked_at IS NULL OR library_checked_at < ?
    ORDER BY date_added ${order}
    LIMIT ?
  `).all(oneDayAgo, limit) as BookWithUser[];
}

export function getAllBooksNeedingRatings(limit: number): BookWithUser[] {
  return db.prepare(`
    SELECT user_id as userId, ${BOOK_SELECT}
    FROM books
    WHERE num_ratings IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as BookWithUser[];
}

export function getAllBooksNeedingGenres(limit: number): BookWithUser[] {
  return db.prepare(`
    SELECT user_id as userId, ${BOOK_SELECT}
    FROM books
    WHERE genres IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as BookWithUser[];
}

export function getAllBooksNeedingCulture(limit: number): BookWithUser[] {
  return db.prepare(`
    SELECT user_id as userId, ${BOOK_SELECT}
    FROM books
    WHERE culture IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as BookWithUser[];
}

export function getAllBooksNeedingPublishYears(limit: number): BookWithUser[] {
  return db.prepare(`
    SELECT user_id as userId, ${BOOK_SELECT}
    FROM books
    WHERE publish_year IS NULL
    ORDER BY date_added DESC
    LIMIT ?
  `).all(limit) as BookWithUser[];
}

export function updatePublishYear(userId: number, bookId: string, year: number): void {
  db.prepare(`UPDATE books SET publish_year = ? WHERE user_id = ? AND book_id = ?`).run(year, userId, bookId);
}

// --- Import ---

export function importGoodreadsCSV(filepath: string, userId: number): number {
  const content = readFileSync(filepath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO books (user_id, book_id, title, author, isbn, isbn13, date_added, avg_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const toReadBooks = records.filter((row) => row["Exclusive Shelf"] === "to-read");

  const tx = db.transaction(() => {
    for (const row of toReadBooks) {
      insert.run(
        userId,
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

// --- Recommendations (user-scoped) ---

export function getRecommendations(userId: number): Recommendation[] {
  return db.prepare(`
    SELECT id, title, author, recommended_by as recommendedBy, created_at as createdAt
    FROM recommendations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as Recommendation[];
}

export function addRecommendation(userId: number, title: string, author: string | null, recommendedBy: string): Recommendation {
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO recommendations (user_id, title, author, recommended_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, title, author, recommendedBy, createdAt);

  return {
    id: result.lastInsertRowid as number,
    title,
    author,
    recommendedBy,
    createdAt,
  };
}

export function deleteRecommendation(userId: number, id: number): void {
  db.prepare(`DELETE FROM recommendations WHERE id = ? AND user_id = ?`).run(id, userId);
}

// --- Finished Books (user-scoped) ---

export function getFinishedBooks(userId: number): FinishedBook[] {
  return db.prepare(`
    SELECT id, title, author, vibe, review, finished_at as finishedAt
    FROM finished_books
    WHERE user_id = ?
    ORDER BY finished_at DESC
  `).all(userId) as FinishedBook[];
}

export function addFinishedBook(userId: number, title: string, author: string | null, vibe: string | null, review: string | null): FinishedBook {
  const finishedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO finished_books (user_id, title, author, vibe, review, finished_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, title, author, vibe, review, finishedAt);

  return {
    id: result.lastInsertRowid as number,
    title,
    author,
    vibe,
    review,
    finishedAt,
  };
}

export function updateFinishedBook(userId: number, id: number, vibe: string | null, review: string | null): void {
  db.prepare(`UPDATE finished_books SET vibe = ?, review = ? WHERE id = ? AND user_id = ?`).run(vibe, review, id, userId);
}

export function deleteFinishedBook(userId: number, id: number): void {
  db.prepare(`DELETE FROM finished_books WHERE id = ? AND user_id = ?`).run(id, userId);
}

export { db };
