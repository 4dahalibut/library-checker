import express from "express";
import { getAllBooks, getStats, getAllGenres, updateLibraryData, addBook, deleteBook, togglePin, updateNotes, db } from "./db.js";
import { searchLibrary, searchEditions } from "./library.js";
import { getHolds, placeHold, cancelHold } from "./holds.js";

const app = express();
const PORT = 3456;

app.use(express.json());

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

app.post("/api/hold/:bibId", async (req, res) => {
  const { bibId } = req.params;
  try {
    const result = await placeHold(bibId);
    res.json(result);
  } catch (error) {
    console.error("Error placing hold:", error);
    res.status(500).json({ success: false, message: "Failed to place hold" });
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

app.delete("/api/hold/:holdId", async (req, res) => {
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

app.post("/api/add-book", async (req, res) => {
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

app.delete("/api/book/:bookId", (req, res) => {
  const { bookId } = req.params;
  deleteBook(bookId);
  res.json({ success: true });
});

app.post("/api/pin/:bookId", (req, res) => {
  const { bookId } = req.params;
  const pinned = togglePin(bookId);
  res.json({ success: true, pinned });
});

app.post("/api/notes/:bookId", (req, res) => {
  const { bookId } = req.params;
  const { notes } = req.body;
  updateNotes(bookId, notes);
  res.json({ success: true });
});

app.post("/api/refresh/:bookId", async (req, res) => {
  const { bookId } = req.params;
  const books = getAllBooks();
  const book = books.find(b => b.bookId === bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  // Try multiple search strategies
  const queries = [
    book.isbn13,
    book.isbn,
    `${book.title} ${book.author}`,
    book.title,
  ].filter(Boolean) as string[];

  let result = null;
  for (const query of queries) {
    console.log(`Refreshing "${book.title}" with query: ${query}`);
    result = await searchLibrary(query);
    if (result) {
      console.log(`Found with query: ${query}`);
      break;
    }
  }
  console.log(`Result:`, result);

  if (result) {
    updateLibraryData(
      bookId,
      result.status,
      result.availableCopies,
      result.totalCopies,
      result.heldCopies,
      result.format,
      result.catalogUrl,
      result.squirrelHillAvailable
    );
    res.json({
      libraryStatus: result.status,
      availableCopies: result.availableCopies,
      totalCopies: result.totalCopies,
      heldCopies: result.heldCopies,
      libraryFormat: result.format,
      catalogUrl: result.catalogUrl,
      squirrelHillAvailable: result.squirrelHillAvailable,
    });
  } else {
    updateLibraryData(bookId, "NOT_FOUND", null, null, null, null, null, false);
    res.json({ libraryStatus: "NOT_FOUND", squirrelHillAvailable: false });
  }
});

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
