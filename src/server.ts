import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";
import { getAllBooks, getStats, getAllGenres, updateLibraryData, addBook, deleteBook, togglePin, updateNotes, updateNumRatings, getRecommendations, addRecommendation, deleteRecommendation, getFinishedBooks, addFinishedBook, updateFinishedBook, deleteFinishedBook, getUserByUsername, getUserById, createUser, db } from "./db.js";
import { searchLibrary, searchEditions, searchByISBN, searchByTitleAuthor } from "./library.js";
import { getHolds, placeHold, cancelHold, discoverAccountId, type LibraryCredentials } from "./holds.js";
import { fetchNumRatings } from "./goodreads.js";
import { authMiddleware, hashPassword, verifyPassword, createSession, deleteSession, getSessionUser, parseCookies, getSessionCookie, getClearSessionCookie } from "./auth.js";
import { plankRouter } from "./plank/routes.js";
import { plankDb } from "./plank/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3456");
const isProduction = process.env.NODE_ENV === "production";

app.use(express.json());

// Hostname-based routing for plank app
app.use((req, res, next) => {
  const host = req.hostname;
  if (host.startsWith("plank")) {
    return plankRouter(req, res, next);
  }
  next();
});

// Mount plank routes at /plank
app.use("/plank", plankRouter);

// Serve plank app at /plank
if (isProduction) {
  app.use("/plank", express.static(join(__dirname, "plank-client"), { index: false }));
}
app.get("/plank", (_req, res) => {
  if (isProduction) {
    res.sendFile(join(__dirname, "plank-client", "plank.html"));
  } else {
    res.redirect("http://localhost:5556/plank.html");
  }
});

// Helper to resolve a username param to userId
function resolveUser(username: string): { userId: number; username: string } | null {
  const user = getUserByUsername(username);
  if (!user) return null;
  return { userId: user.id, username: user.username };
}

// --- Auth routes ---

app.post("/api/register", async (req, res) => {
  const { username, password, libraryBarcode, libraryPin } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  if (!libraryBarcode || !libraryPin) {
    res.status(400).json({ error: "Library card barcode and PIN required" });
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    res.status(400).json({ error: "Username must be alphanumeric (hyphens and underscores allowed)" });
    return;
  }
  if (username.length < 2 || username.length > 30) {
    res.status(400).json({ error: "Username must be 2-30 characters" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters" });
    return;
  }

  const existing = getUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const accountId = await discoverAccountId(libraryBarcode, libraryPin);
  if (!accountId) {
    res.status(400).json({ error: "Invalid library credentials. Check your barcode and PIN." });
    return;
  }

  const passwordHash = hashPassword(password);
  const user = createUser(username, passwordHash, libraryBarcode, libraryPin, accountId);
  const sessionId = createSession(user.id);
  res.setHeader("Set-Cookie", getSessionCookie(sessionId, isProduction));
  res.json({ success: true, username: user.username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const sessionId = createSession(user.id);
  res.setHeader("Set-Cookie", getSessionCookie(sessionId, isProduction));
  res.json({ success: true, username: user.username });
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
  const user = getSessionUser(cookies.session_id);
  res.json({ authenticated: !!user, username: user?.username || null });
});

// --- Public user-scoped read routes ---

app.get("/api/u/:username/books", (req, res) => {
  const user = resolveUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const books = getAllBooks(user.userId);
  const stats = getStats(user.userId);
  const genres = getAllGenres(user.userId);
  res.json({ books, stats, genres });
});

app.get("/api/u/:username/finished", (req, res) => {
  const user = resolveUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const books = getFinishedBooks(user.userId);
  res.json({ books });
});

app.get("/api/u/:username/recommendations", (req, res) => {
  const user = resolveUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const recommendations = getRecommendations(user.userId);
  res.json({ recommendations });
});

// Public: anyone can submit a recommendation for a user
app.post("/api/u/:username/recommendations", (req, res) => {
  const user = resolveUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const { title, author, recommendedBy } = req.body;
  if (!title || !recommendedBy) {
    res.status(400).json({ error: "Title and your name are required" });
    return;
  }
  const recommendation = addRecommendation(user.userId, title, author || null, recommendedBy);
  res.json({ success: true, recommendation });
});

// --- Auth-required routes (use req.user) ---

app.get("/api/books", authMiddleware, (req, res) => {
  const books = getAllBooks(req.user!.userId);
  const stats = getStats(req.user!.userId);
  const genres = getAllGenres(req.user!.userId);
  res.json({ books, stats, genres });
});

app.get("/api/holds", authMiddleware, async (req, res) => {
  try {
    const user = getUserById(req.user!.userId);
    if (!user?.libraryBarcode || !user?.libraryPin || !user?.libraryAccountId) {
      res.status(400).json({ error: "No library credentials configured" });
      return;
    }
    const creds: LibraryCredentials = { barcode: user.libraryBarcode, pin: user.libraryPin, accountId: user.libraryAccountId };
    const holds = await getHolds(creds);
    res.json({ holds });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch holds" });
  }
});

app.delete("/api/recommendations/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  deleteRecommendation(req.user!.userId, id);
  res.json({ success: true });
});

// Finished books - auth-required
app.get("/api/finished", authMiddleware, (req, res) => {
  const books = getFinishedBooks(req.user!.userId);
  res.json({ books });
});

app.post("/api/finished", authMiddleware, (req, res) => {
  const { title, author, vibe, review } = req.body;
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const book = addFinishedBook(req.user!.userId, title, author || null, vibe || null, review || null);
  res.json({ success: true, book });
});

app.put("/api/finished/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { vibe, review } = req.body;
  updateFinishedBook(req.user!.userId, id, vibe ?? null, review ?? null);
  res.json({ success: true });
});

app.delete("/api/finished/:id", authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  deleteFinishedBook(req.user!.userId, id);
  res.json({ success: true });
});

// Protected routes - require authentication
app.post("/api/hold/:bibId", authMiddleware, async (req, res) => {
  const { bibId } = req.params;
  try {
    const user = getUserById(req.user!.userId);
    if (!user?.libraryBarcode || !user?.libraryPin || !user?.libraryAccountId) {
      res.status(400).json({ success: false, message: "No library credentials configured" });
      return;
    }
    const creds: LibraryCredentials = { barcode: user.libraryBarcode, pin: user.libraryPin, accountId: user.libraryAccountId };
    const result = await placeHold(bibId, creds);
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
    const user = getUserById(req.user!.userId);
    if (!user?.libraryBarcode || !user?.libraryPin || !user?.libraryAccountId) {
      res.status(400).json({ success: false, message: "No library credentials configured" });
      return;
    }
    const creds: LibraryCredentials = { barcode: user.libraryBarcode, pin: user.libraryPin, accountId: user.libraryAccountId };
    const result = await cancelHold(holdId, metadataId, creds);
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

  const userId = req.user!.userId;

  let title: string;
  let author: string;
  let bookIsbn: string | undefined;
  let bookIsbn13: string | undefined;
  let publishYear: number | undefined;

  if (isbn) {
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
    const yearMatch = bookData.publish_date?.match(/\d{4}/);
    publishYear = yearMatch ? parseInt(yearMatch[0]) : undefined;
  } else {
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

  addBook({ userId, bookId, title, author, isbn13: bookIsbn13, isbn: bookIsbn, publishYear });

  // Check library availability
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
      userId,
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
    updateLibraryData(userId, bookId, "NOT_FOUND", null, null, null, null, null, false);
  }

  res.json({ success: true, bookId, title, author });
});

app.delete("/api/book/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  deleteBook(req.user!.userId, bookId);
  res.json({ success: true });
});

app.post("/api/pin/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  const pinned = togglePin(req.user!.userId, bookId);
  res.json({ success: true, pinned });
});

app.post("/api/notes/:bookId", authMiddleware, (req, res) => {
  const { bookId } = req.params;
  const { notes } = req.body;
  updateNotes(req.user!.userId, bookId, notes);
  res.json({ success: true });
});

app.post("/api/refresh/:bookId", authMiddleware, async (req, res) => {
  const { bookId } = req.params;
  const userId = req.user!.userId;
  const books = getAllBooks(userId);
  const book = books.find(b => b.bookId === bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

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

  if (numRatings > 0) {
    updateNumRatings(userId, bookId, numRatings);
  }

  if (libraryResult) {
    updateLibraryData(
      userId,
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
    updateLibraryData(userId, bookId, "NOT_FOUND", null, null, null, null, null, false);
    res.json({ libraryStatus: "NOT_FOUND", squirrelHillAvailable: false, numRatings });
  }
});

// --- HTML serving ---

if (isProduction) {
  const clientDist = join(__dirname, "client");
  const plankDist = join(__dirname, "plank-client");

  // Route static files and HTML based on hostname
  app.use((req, res, next) => {
    const host = req.hostname;
    if (host.startsWith("plank")) {
      if (req.path === "/" || !req.path.includes(".")) {
        return res.sendFile(join(plankDist, "plank.html"));
      }
      return express.static(plankDist)(req, res, next);
    }
    next();
  });

  app.use(express.static(clientDist));

  app.get("/u/:username", (_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });

  app.get("/u/:username/finished", (_req, res) => {
    res.sendFile(join(clientDist, "finished.html"));
  });

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
    plankDb.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
