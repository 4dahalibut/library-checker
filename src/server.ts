import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";
import { getAllBooks, getStats, getAllGenres, updateLibraryData, addBook, deleteBook, togglePin, updateNotes, updateNumRatings, getRecommendations, addRecommendation, deleteRecommendation, getFinishedBooks, addFinishedBook, updateFinishedBook, deleteFinishedBook, db } from "./db.js";
import { searchLibrary, searchEditions, searchByISBN, searchByTitleAuthor } from "./library.js";
import { getHolds, placeHold, cancelHold } from "./holds.js";
import { fetchNumRatings } from "./goodreads.js";
import { authMiddleware, validateCredentials, createSession, deleteSession, verifySession, parseCookies, getSessionCookie, getClearSessionCookie } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3456");
const isProduction = process.env.NODE_ENV === "production";

app.use(express.json());

// Public auth routes
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (validateCredentials(password)) {
    const sessionId = createSession();
    res.setHeader("Set-Cookie", getSessionCookie(sessionId, isProduction));
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session_id) {
    deleteSession(cookies.session_id);
  }
  res.setHeader("Set-Cookie", getClearSessionCookie());
  res.json({ success: true });
});

app.get("/api/status", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const authenticated = verifySession(cookies.session_id);
  res.json({ authenticated });
});

// Public read routes
app.get("/api/books", (_req, res) => {
  const books = getAllBooks();
  const stats = getStats();
  const genres = getAllGenres();
  res.json({ books, stats, genres });
});

app.get("/api/holds", async (_req, res) => {
  try {
    const holds = await getHolds();
    res.json({ holds });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch holds" });
  }
});

// Public recommendations routes
app.get("/api/recommendations", (_req, res) => {
  const recommendations = getRecommendations();
  res.json({ recommendations });
});

app.post("/api/recommendations", (req, res) => {
  const { title, author, recommendedBy } = req.body;
  if (!title || !recommendedBy) {
    res.status(400).json({ error: "Title and your name are required" });
    return;
  }
  const recommendation = addRecommendation(title, author || null, recommendedBy);
  res.json({ success: true, recommendation });
});

app.delete("/api/recommendations/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  deleteRecommendation(id);
  res.json({ success: true });
});

// Finished books routes (all protected)
app.get("/api/finished", (_req, res) => {
  const books = getFinishedBooks();
  res.json({ books });
});

app.post("/api/finished", authMiddleware, (req, res) => {
  const { title, author, rating, review } = req.body;
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const book = addFinishedBook(title, author || null, rating || null, review || null);
  res.json({ success: true, book });
});

app.put("/api/finished/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { rating, review } = req.body;
  updateFinishedBook(id, rating ?? null, review ?? null);
  res.json({ success: true });
});

app.delete("/api/finished/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  deleteFinishedBook(id);
  res.json({ success: true });
});

// Protected routes - require authentication
app.post("/api/hold/:bibId", authMiddleware, async (req, res) => {
  const { bibId } = req.params;
  try {
    const result = await placeHold(bibId);
    if (!result.success) {
      console.error("Hold failed:", result.message);
    }
    res.json(result);
  } catch (error) {
    console.error("Error placing hold:", error);
    const message = error instanceof Error ? error.message : "Failed to place hold";
    res.status(500).json({ success: false, message });
  }
});

app.get("/api/editions", async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Query parameter 'q' required" });
    return;
  }
  try {
    const editions = await searchEditions(q);
    res.json({ editions });
  } catch (error) {
    console.error("Error searching editions:", error);
    res.status(500).json({ error: "Failed to search editions" });
  }
});

app.delete("/api/hold/:holdId", authMiddleware, async (req, res) => {
  const { holdId } = req.params;
  const { metadataId } = req.body;
  try {
    const result = await cancelHold(holdId, metadataId);
    res.json(result);
  } catch (error) {
    console.error("Error cancelling hold:", error);
    res.status(500).json({ success: false, message: "Failed to cancel hold" });
  }
});

app.post("/api/add-book", authMiddleware, async (req, res) => {
  const { isbn, keyword } = req.body;
  if (!isbn && !keyword) {
    res.status(400).json({ error: "ISBN or keyword required" });
    return;
  }

  let title: string;
  let author: string;
  let bookIsbn: string | undefined;
  let bookIsbn13: string | undefined;
  let publishYear: number | undefined;

  if (isbn) {
    // Look up by ISBN on Open Library
    const openLibUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const openLibRes = await fetch(openLibUrl);
    const openLibData = await openLibRes.json();
    const bookData = openLibData[`ISBN:${isbn}`];

    if (!bookData) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    title = bookData.title || "Unknown Title";
    author = bookData.authors?.[0]?.name || "Unknown Author";
    bookIsbn13 = isbn.length === 13 ? isbn : undefined;
    bookIsbn = isbn.length === 10 ? isbn : undefined;
    // Extract year from publish_date (could be "1873-77", "2014", etc.)
    const yearMatch = bookData.publish_date?.match(/\d{4}/);
    publishYear = yearMatch ? parseInt(yearMatch[0]) : undefined;
  } else {
    // Search by keyword on Open Library
    const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(keyword)}&limit=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.docs || searchData.docs.length === 0) {
      res.status(404).json({ error: "Book not found" });
      return;
    }

    const doc = searchData.docs[0];
    title = doc.title || "Unknown Title";
    author = doc.author_name?.[0] || "Unknown Author";
    bookIsbn13 = doc.isbn?.find((i: string) => i.length === 13);
    bookIsbn = doc.isbn?.find((i: string) => i.length === 10);
    publishYear = doc.first_publish_year;
  }

  const bookId = `manual-${isbn || keyword.replace(/\s+/g, "-")}-${Date.now()}`;

  addBook({ bookId, title, author, isbn13: bookIsbn13, isbn: bookIsbn, publishYear });

  // Check library availability - try multiple search strategies
  const queries = [bookIsbn13, bookIsbn, `${title} ${author}`, title].filter(Boolean) as string[];
  let libraryResult = null;
  for (const query of queries) {
    console.log(`Searching library for "${title}" with query: ${query}`);
    libraryResult = await searchLibrary(query);
    if (libraryResult) {
      console.log(`Found with query: ${query}`);
      break;
    }
  }

  if (libraryResult) {
    updateLibraryData(
      bookId,
      libraryResult.status,
      libraryResult.availableCopies,
      libraryResult.totalCopies,
      libraryResult.heldCopies,
      libraryResult.format,
      libraryResult.catalogUrl,
      libraryResult.squirrelHillAvailable
    );
  } else {
    updateLibraryData(bookId, "NOT_FOUND", null, null, null, null, null, false);
  }

  res.json({ success: true, bookId, title, author });
});

app.delete("/api/book/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  deleteBook(bookId);
  res.json({ success: true });
});

app.post("/api/pin/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  const pinned = togglePin(bookId);
  res.json({ success: true, pinned });
});

app.post("/api/notes/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  const { notes } = req.body;
  updateNotes(bookId, notes);
  res.json({ success: true });
});

app.post("/api/refresh/:bookId", authMiddleware, async (req, res) => {
  const { bookId } = req.params;
  const books = getAllBooks();
  const book = books.find(b => b.bookId === bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  // Fetch library data and Goodreads ratings in parallel
  const [libraryResult, numRatings] = await Promise.all([
    (async () => {
      let result = await searchByISBN(book.isbn13 || book.isbn);
      if (!result) {
        result = await searchByTitleAuthor(book.title, book.author);
      }
      return result;
    })(),
    fetchNumRatings(bookId),
  ]);

  console.log(`Refresh "${book.title}":`, libraryResult ? `found (${libraryResult.status})` : "not found", `ratings: ${numRatings}`);

  // Update ratings
  if (numRatings > 0) {
    updateNumRatings(bookId, numRatings);
  }

  if (libraryResult) {
    updateLibraryData(
      bookId,
      libraryResult.status,
      libraryResult.availableCopies,
      libraryResult.totalCopies,
      libraryResult.heldCopies,
      libraryResult.format,
      libraryResult.catalogUrl,
      libraryResult.squirrelHillAvailable
    );
    res.json({
      libraryStatus: libraryResult.status,
      availableCopies: libraryResult.availableCopies,
      totalCopies: libraryResult.totalCopies,
      heldCopies: libraryResult.heldCopies,
      libraryFormat: libraryResult.format,
      catalogUrl: libraryResult.catalogUrl,
      squirrelHillAvailable: libraryResult.squirrelHillAvailable,
      numRatings,
    });
  } else {
    updateLibraryData(bookId, "NOT_FOUND", null, null, null, null, null, false);
    res.json({ libraryStatus: "NOT_FOUND", squirrelHillAvailable: false, numRatings });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  const clientDist = join(__dirname, "client");
  app.use(express.static(clientDist));

  // Serve HTML pages (express.static handles file matches, this handles root path)
  app.get("/", (_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});

function shutdown() {
  console.log("Shutting down...");
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
