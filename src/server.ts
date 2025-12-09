import express from "express";
import { getAllBooks, getStats, getAllGenres, updateLibraryData, addBook, deleteBook, togglePin } from "./db.js";
import { searchLibrary } from "./library.js";
import { getHolds, placeHold, cancelHold } from "./holds.js";

const app = express();
const PORT = 3456;

app.use(express.json());

app.get("/", (_req, res) => {
  res.send(getHTML());
});

app.get("/api/books", (_req, res) => {
  const books = getAllBooks();
  const stats = getStats();
  const genres = getAllGenres();
  res.json({ books, stats, genres });
});

app.get("/holds", (_req, res) => {
  res.send(getHoldsHTML());
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

app.post("/api/add-isbn", async (req, res) => {
  const { isbn } = req.body;
  if (!isbn) {
    res.status(400).json({ error: "ISBN required" });
    return;
  }

  // Look up on Open Library (free API, no key needed)
  const openLibUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const openLibRes = await fetch(openLibUrl);
  const openLibData = await openLibRes.json();
  const bookData = openLibData[`ISBN:${isbn}`];

  if (!bookData) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const bookId = `manual-${isbn}-${Date.now()}`;
  const title = bookData.title || "Unknown Title";
  const author = bookData.authors?.[0]?.name || "Unknown Author";

  addBook({ bookId, title, author, isbn13: isbn.length === 13 ? isbn : undefined, isbn: isbn.length === 10 ? isbn : undefined });

  // Check library availability
  const libraryResult = await searchLibrary(isbn);
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

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Library Checker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 { margin-bottom: 10px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat { background: #16213e; padding: 15px 25px; border-radius: 8px; }
    .stat-value { font-size: 2em; font-weight: bold; }
    .stat-label { color: #888; font-size: 0.9em; }
    .stat.available .stat-value { color: #4ade80; }
    .stat.unavailable .stat-value { color: #fbbf24; }
    .stat.not-found .stat-value { color: #f87171; }
    .stat.unchecked .stat-value { color: #888; }

    .filters { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    .filter-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: #16213e;
      color: #eee;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn:hover { background: #1f4068; }
    .filter-btn.active { background: #0f3460; border: 1px solid #4ade80; }
    .separator { color: #666; margin: 0 4px; }

    .genre-filters { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .genre-btn {
      padding: 4px 10px;
      border: none;
      border-radius: 12px;
      background: #16213e;
      color: #9ca3af;
      cursor: pointer;
      font-size: 0.8em;
      transition: all 0.2s;
    }
    .genre-btn:hover { background: #1f4068; color: #eee; }
    .genre-btn.active { background: #7c3aed; color: #fff; }
    .genre-btn .count { color: #666; margin-left: 4px; }

    .book-genres { margin-top: 6px; }
    .book-genre {
      display: inline-block;
      padding: 2px 8px;
      margin: 2px;
      border-radius: 10px;
      background: #2d2d44;
      color: #a5b4fc;
      font-size: 0.75em;
      cursor: pointer;
    }
    .book-genre:hover { background: #7c3aed; color: #fff; }

    .book-list { display: flex; flex-direction: column; gap: 12px; }
    .book {
      background: #16213e;
      border-radius: 8px;
      padding: 16px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
    }
    .book-info { min-width: 0; }
    .book-title {
      font-weight: 600;
      font-size: 1.1em;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .book-author { color: #888; font-size: 0.9em; margin-bottom: 8px; }
    .book-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.85em; }
    .book-meta span { color: #888; }

    .availability { text-align: right; min-width: 140px; }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .status.available { background: #166534; color: #4ade80; }
    .status.unavailable { background: #854d0e; color: #fbbf24; }
    .status.not-found { background: #7f1d1d; color: #f87171; }
    .status.unchecked { background: #374151; color: #9ca3af; }

    .copies { font-size: 0.9em; color: #888; }
    .holds { font-size: 0.85em; color: #f97316; margin-top: 2px; }
    .squirrel-hill { font-size: 0.85em; color: #22d3ee; margin-top: 2px; }
    .catalog-link {
      display: inline-block;
      margin-top: 6px;
      color: #60a5fa;
      text-decoration: none;
      font-size: 0.85em;
    }
    .catalog-link:hover { text-decoration: underline; }
    .refresh-btn {
      background: #1f4068;
      border: none;
      color: #9ca3af;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
      margin-left: 8px;
    }
    .refresh-btn:hover { background: #0f3460; color: #fff; }
    .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .hold-btn {
      background: #166534;
      border: none;
      color: #4ade80;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
      margin-left: 8px;
    }
    .hold-btn:hover { background: #15803d; color: #fff; }
    .hold-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .hold-btn.success { background: #0f766e; color: #5eead4; }
    .hold-btn.error { background: #7f1d1d; color: #f87171; }
    .delete-btn {
      background: transparent;
      border: none;
      color: #666;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 1em;
      margin-left: 4px;
    }
    .delete-btn:hover { color: #f87171; }
    .pin-btn {
      background: transparent;
      border: none;
      color: #666;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 1em;
      margin-left: 4px;
    }
    .pin-btn:hover { color: #fbbf24; }
    .pin-btn.pinned { color: #fbbf24; }

    .add-book-form {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      align-items: center;
    }
    .add-book-form input {
      padding: 8px 12px;
      border: 1px solid #374151;
      border-radius: 6px;
      background: #16213e;
      color: #eee;
      font-size: 1em;
      width: 200px;
    }
    .add-book-form input:focus { outline: none; border-color: #4ade80; }
    .add-book-form button {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: #166534;
      color: #4ade80;
      cursor: pointer;
      font-size: 1em;
    }
    .add-book-form button:hover { background: #15803d; }
    .add-book-form button:disabled { opacity: 0.5; cursor: not-allowed; }
    .add-book-form .status { color: #888; font-size: 0.9em; }

    .loading { text-align: center; padding: 40px; color: #888; }
    .commands { background: #16213e; padding: 16px; border-radius: 8px; margin-top: 20px; font-size: 0.9em; }
    .commands code { background: #0f3460; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Library Availability Checker</h1>
  <p class="subtitle">Goodreads "Want to Read" + Carnegie Library of Pittsburgh | <a href="/holds" style="color: #60a5fa;">My Holds</a></p>

  <div id="app"><div class="loading">Loading...</div></div>

  <script>
    let allBooks = [];
    let stats = {};
    let genres = [];
    let currentFilter = 'all';
    let currentSort = 'date';
    let currentGenre = null;
    let currentCulture = null;

    async function loadBooks() {
      const res = await fetch('/api/books');
      const data = await res.json();
      allBooks = data.books || [];
      stats = data.stats || {};
      genres = data.genres || [];
      render();
    }

    function render() {
      let filtered = filterBooks(allBooks, currentFilter);
      if (currentGenre) {
        filtered = filtered.filter(b => {
          const bookGenres = b.genres ? JSON.parse(b.genres) : [];
          return bookGenres.includes(currentGenre);
        });
      }
      if (currentCulture) {
        filtered = filtered.filter(b => b.culture === currentCulture);
      }
      filtered = sortBooks(filtered, currentSort);

      document.getElementById('app').innerHTML = \`
        <div class="stats">
          <div class="stat available">
            <div class="stat-value">\${stats.available || 0}</div>
            <div class="stat-label">Available</div>
          </div>
          <div class="stat unavailable">
            <div class="stat-value">\${stats.unavailable || 0}</div>
            <div class="stat-label">Checked Out</div>
          </div>
          <div class="stat not-found">
            <div class="stat-value">\${stats.notFound || 0}</div>
            <div class="stat-label">Not in Catalog</div>
          </div>
          <div class="stat unchecked">
            <div class="stat-value">\${stats.unchecked || 0}</div>
            <div class="stat-label">Unchecked</div>
          </div>
          <div class="stat">
            <div class="stat-value">\${stats.total || 0}</div>
            <div class="stat-label">Total</div>
          </div>
        </div>

        <div class="filters">
          <button class="filter-btn \${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">All</button>
          <button class="filter-btn \${currentFilter === 'physical' ? 'active' : ''}" onclick="setFilter('physical')">Physical</button>
          <button class="filter-btn \${currentFilter === 'pinned' ? 'active' : ''}" onclick="setFilter('pinned')">Pinned</button>
          <button class="filter-btn \${currentFilter === 'available' ? 'active' : ''}" onclick="setFilter('available')">Available</button>
          <button class="filter-btn \${currentFilter === 'squirrel-hill' ? 'active' : ''}" onclick="setFilter('squirrel-hill')">Squirrel Hill</button>
          <button class="filter-btn \${currentFilter === 'unavailable' ? 'active' : ''}" onclick="setFilter('unavailable')">Checked Out</button>
          <button class="filter-btn \${currentFilter === 'not-found' ? 'active' : ''}" onclick="setFilter('not-found')">Not Found</button>
          <button class="filter-btn \${currentFilter === 'unchecked' ? 'active' : ''}" onclick="setFilter('unchecked')">Unchecked</button>
          <span class="separator">|</span>
          <button class="filter-btn \${currentSort === 'date' ? 'active' : ''}" onclick="setSort('date')">By Date</button>
          <button class="filter-btn \${currentSort === 'popularity' ? 'active' : ''}" onclick="setSort('popularity')">By Popularity</button>
          <button class="filter-btn \${currentSort === 'rating' ? 'active' : ''}" onclick="setSort('rating')">By Rating</button>
          <button class="filter-btn \${currentSort === 'copies' ? 'active' : ''}" onclick="setSort('copies')">By Copies</button>
        </div>

        <div class="add-book-form">
          <input type="text" id="isbn-input" placeholder="Enter ISBN..." />
          <button onclick="addByISBN()">Add Book</button>
          <span id="add-status" class="status"></span>
        </div>

        \${genres.length > 0 ? \`
        <div class="genre-filters">
          <button class="genre-btn \${!currentGenre ? 'active' : ''}" onclick="setGenre(null)">All Genres</button>
          \${genres.slice(0, 20).map(g => \`
            <button class="genre-btn \${currentGenre === g.genre ? 'active' : ''}" onclick="setGenre('\${g.genre}')">\${g.genre}<span class="count">(\${g.count})</span></button>
          \`).join('')}
        </div>
        \` : ''}

        <div class="genre-filters">
          <button class="genre-btn \${!currentCulture ? 'active' : ''}" onclick="setCulture(null)">All Cultures</button>
          \${getCultureCounts().map(c => \`
            <button class="genre-btn \${currentCulture === c.culture ? 'active' : ''}" onclick="setCulture('\${c.culture}')">\${c.culture}<span class="count">(\${c.count})</span></button>
          \`).join('')}
        </div>

        <div class="book-list">
          \${filtered.map(renderBook).join('')}
        </div>

        <div class="commands">
          <strong>Commands:</strong><br>
          <code>npm run import</code> - Import/update from Goodreads CSV<br>
          <code>npm run refresh:library 200</code> - Check library availability<br>
          <code>npm run refresh:ratings 200</code> - Fetch Goodreads rating counts<br>
          <code>npm run refresh:genres 200</code> - Fetch Goodreads genres
        </div>
      \`;
    }

    function isEbook(book) {
      return book.libraryFormat && (book.libraryFormat.toLowerCase().includes('ebook') || book.libraryFormat.toLowerCase().includes('e-book'));
    }

    function filterBooks(books, filter) {
      switch (filter) {
        case 'physical': return books.filter(b => b.libraryStatus && b.libraryStatus !== 'NOT_FOUND' && !isEbook(b));
        case 'pinned': return books.filter(b => b.pinned);
        case 'available': return books.filter(b => b.libraryStatus === 'AVAILABLE' && !isEbook(b));
        case 'squirrel-hill': return books.filter(b => b.squirrelHillAvailable && !isEbook(b));
        case 'unavailable': return books.filter(b => b.libraryStatus === 'UNAVAILABLE' && !isEbook(b));
        case 'not-found': return books.filter(b => b.libraryStatus === 'NOT_FOUND' || isEbook(b));
        case 'unchecked': return books.filter(b => !b.libraryStatus);
        default: return books;
      }
    }

    function sortBooks(books, sort) {
      switch (sort) {
        case 'popularity':
          return [...books].sort((a, b) => (b.numRatings || 0) - (a.numRatings || 0));
        case 'rating':
          return [...books].sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
        case 'copies':
          return [...books].sort((a, b) => (b.totalCopies || 0) - (a.totalCopies || 0));
        default:
          return [...books].sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
      }
    }

    function setFilter(f) { currentFilter = f; render(); }
    function setSort(s) { currentSort = s; render(); }
    function setGenre(g) { currentGenre = g; render(); }
    function setCulture(c) { currentCulture = c; render(); }

    function getCultureCounts() {
      const counts = {};
      for (const book of allBooks) {
        if (book.culture) {
          counts[book.culture] = (counts[book.culture] || 0) + 1;
        }
      }
      return Object.entries(counts)
        .map(([culture, count]) => ({ culture, count }))
        .sort((a, b) => b.count - a.count);
    }

    async function addByISBN() {
      const input = document.getElementById('isbn-input');
      const status = document.getElementById('add-status');
      const isbn = input.value.trim().replace(/-/g, '');
      if (!isbn) return;

      status.textContent = 'Looking up...';
      try {
        const res = await fetch('/api/add-isbn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isbn })
        });
        const data = await res.json();
        if (data.success) {
          status.textContent = 'Added: ' + data.title;
          input.value = '';
          loadBooks();
        } else {
          status.textContent = data.error || 'Not found';
        }
      } catch (e) {
        status.textContent = 'Error adding book';
      }
    }

    async function deleteBookById(bookId) {
      try {
        await fetch('/api/book/' + encodeURIComponent(bookId), { method: 'DELETE' });
        allBooks = allBooks.filter(b => b.bookId !== bookId);
        render();
      } catch (e) {
        console.error(e);
      }
    }

    async function togglePinBook(bookId) {
      try {
        const res = await fetch('/api/pin/' + encodeURIComponent(bookId), { method: 'POST' });
        const data = await res.json();
        const idx = allBooks.findIndex(b => b.bookId === bookId);
        if (idx >= 0) allBooks[idx].pinned = data.pinned;
        render();
      } catch (e) {
        console.error(e);
      }
    }

    async function refreshBook(bookId) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await fetch('/api/refresh/' + bookId, { method: 'POST' });
        const updated = await res.json();
        const idx = allBooks.findIndex(b => b.bookId === bookId);
        if (idx >= 0) allBooks[idx] = { ...allBooks[idx], ...updated };
        render();
      } catch (e) {
        console.error(e);
        btn.disabled = false;
        btn.textContent = '↻';
      }
    }

    async function holdBook(bibId) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await fetch('/api/hold/' + bibId, { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          btn.textContent = '✓ Held';
          btn.classList.add('success');
        } else {
          btn.textContent = result.message.substring(0, 20);
          btn.classList.add('error');
          setTimeout(() => {
            btn.textContent = 'Hold';
            btn.classList.remove('error');
            btn.disabled = false;
          }, 3000);
        }
      } catch (e) {
        console.error(e);
        btn.textContent = 'Error';
        btn.classList.add('error');
        setTimeout(() => {
          btn.textContent = 'Hold';
          btn.classList.remove('error');
          btn.disabled = false;
        }, 3000);
      }
    }

    function renderBook(book) {
      let statusClass = 'unchecked';
      let statusText = 'Unchecked';
      let copiesText = '';
      let holdsText = '';
      let catalogLink = '';

      const isEbook = book.libraryFormat && (book.libraryFormat.toLowerCase().includes('ebook') || book.libraryFormat.toLowerCase().includes('e-book'));

      if (isEbook) {
        statusClass = 'not-found';
        statusText = 'eBook Only';
      } else if (book.libraryStatus === 'AVAILABLE') {
        statusClass = 'available';
        statusText = 'Available';
        copiesText = \`\${book.availableCopies} / \${book.totalCopies} copies\`;
      } else if (book.libraryStatus === 'UNAVAILABLE') {
        statusClass = 'unavailable';
        statusText = 'Checked Out';
        copiesText = \`0 / \${book.totalCopies} copies\`;
      } else if (book.libraryStatus === 'NOT_FOUND') {
        statusClass = 'not-found';
        statusText = 'Not Found';
      }

      if (book.heldCopies > 0) {
        holdsText = \`\${book.heldCopies} hold\${book.heldCopies > 1 ? 's' : ''}\`;
      }
      const squirrelHillText = book.squirrelHillAvailable ? '@ Squirrel Hill' : '';
      let holdButton = '';
      if (book.catalogUrl) {
        catalogLink = \`<a href="\${book.catalogUrl}" target="_blank" class="catalog-link">View in catalog</a>\`;
        const bibId = book.catalogUrl.split('/').pop();
        if (bibId && !isEbook) {
          holdButton = \`<button class="hold-btn" onclick="holdBook('\${bibId}')">Hold</button>\`;
        }
      }
      const goodreadsLink = \`<a href="https://www.goodreads.com/book/show/\${book.bookId}" target="_blank" class="catalog-link">Goodreads</a>\`;
      const isbn = book.isbn13 || book.isbn;
      const thriftbooksLink = isbn ? \`<a href="https://www.thriftbooks.com/browse/?b.search=\${isbn}" target="_blank" class="catalog-link">ThriftBooks</a>\` : '';

      const dateAdded = book.dateAdded ? new Date(book.dateAdded).toLocaleDateString() : '';
      const ratingInfo = book.avgRating ? \`\${book.avgRating.toFixed(2)} avg\` : '';
      const numRatingsInfo = book.numRatings ? \`\${book.numRatings.toLocaleString()} ratings\` : '';
      const bookGenres = book.genres ? JSON.parse(book.genres) : [];

      return \`
        <div class="book">
          <div class="book-info">
            <div class="book-title">\${escapeHtml(book.title)}</div>
            <div class="book-author">\${escapeHtml(book.author || '')}</div>
            <div class="book-meta">
              \${dateAdded ? \`<span>Added \${dateAdded}</span>\` : ''}
              \${ratingInfo ? \`<span>\${ratingInfo}</span>\` : ''}
              \${numRatingsInfo ? \`<span>\${numRatingsInfo}</span>\` : ''}
              \${book.libraryFormat ? \`<span>\${book.libraryFormat}</span>\` : ''}
            </div>
            \${bookGenres.length > 0 ? \`
              <div class="book-genres">
                \${bookGenres.slice(0, 5).map(g => \`<span class="book-genre" onclick="setGenre('\${g}')">\${g}</span>\`).join('')}
              </div>
            \` : ''}
          </div>
          <div class="availability">
            <div class="status \${statusClass}">\${statusText}</div>
            \${copiesText ? \`<div class="copies">\${copiesText}</div>\` : ''}
            \${holdsText ? \`<div class="holds">\${holdsText}</div>\` : ''}
            \${squirrelHillText ? \`<div class="squirrel-hill">\${squirrelHillText}</div>\` : ''}
            \${catalogLink}
            \${goodreadsLink}
            \${thriftbooksLink}
            \${holdButton}
            <button class="pin-btn \${book.pinned ? 'pinned' : ''}" onclick="togglePinBook('\${book.bookId}')" title="Pin">📌</button>
            <button class="refresh-btn" onclick="refreshBook('\${book.bookId}')">↻</button>
            <button class="delete-btn" onclick="deleteBookById('\${book.bookId}')" title="Remove">×</button>
          </div>
        </div>
      \`;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    loadBooks();
  </script>
</body>
</html>`;
}

function getHoldsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Holds</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { margin-bottom: 10px; color: #fff; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .nav { margin-bottom: 20px; }
    .nav a { color: #60a5fa; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .loading { text-align: center; padding: 40px; color: #888; }
    .holds-list { display: flex; flex-direction: column; gap: 12px; }
    .hold {
      background: #16213e;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .hold-info { flex: 1; }
    .hold-title { font-weight: 600; font-size: 1.1em; margin-bottom: 4px; }
    .hold-author { color: #888; font-size: 0.9em; margin-bottom: 4px; }
    .hold-format { color: #666; font-size: 0.85em; }
    .hold-status {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .hold-status.in_transit { background: #854d0e; color: #fbbf24; }
    .hold-status.not_yet_available { background: #374151; color: #9ca3af; }
    .hold-status.ready { background: #166534; color: #4ade80; }
    .error { color: #f87171; text-align: center; padding: 20px; }
    .hold-actions { display: flex; align-items: center; gap: 12px; }
    .cancel-btn {
      background: #7f1d1d;
      border: none;
      color: #f87171;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .cancel-btn:hover { background: #991b1b; color: #fff; }
    .cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="nav"><a href="/">← Back to Books</a></div>
  <h1>My Holds</h1>
  <p class="subtitle">Carnegie Library of Pittsburgh</p>

  <div id="app"><div class="loading">Loading holds...</div></div>

  <script>
    async function loadHolds() {
      try {
        const res = await fetch('/api/holds');
        const data = await res.json();

        if (data.error) {
          document.getElementById('app').innerHTML = '<div class="error">Failed to load holds</div>';
          return;
        }

        const holds = data.holds || [];
        if (holds.length === 0) {
          document.getElementById('app').innerHTML = '<div class="loading">No holds found</div>';
          return;
        }

        document.getElementById('app').innerHTML = \`
          <div class="holds-list">
            \${holds.map(h => \`
              <div class="hold" id="hold-\${h.holdId}">
                <div class="hold-info">
                  <div class="hold-title">\${escapeHtml(h.title)}</div>
                  <div class="hold-author">by \${escapeHtml(h.author)}</div>
                  <div class="hold-format">\${h.format} \${h.year}</div>
                </div>
                <div class="hold-actions">
                  <div class="hold-status \${h.status}">\${h.statusText}</div>
                  <button class="cancel-btn" onclick="cancelHold('\${h.holdId}', '\${h.bibId}')">Cancel</button>
                </div>
              </div>
            \`).join('')}
          </div>
        \`;
      } catch (e) {
        document.getElementById('app').innerHTML = '<div class="error">Error loading holds</div>';
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function cancelHold(holdId, metadataId) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await fetch('/api/hold/' + holdId, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadataId })
        });
        const result = await res.json();
        if (result.success) {
          document.getElementById('hold-' + holdId).remove();
        } else {
          btn.textContent = result.message.substring(0, 15);
          setTimeout(() => {
            btn.textContent = 'Cancel';
            btn.disabled = false;
          }, 3000);
        }
      } catch (e) {
        btn.textContent = 'Error';
        setTimeout(() => {
          btn.textContent = 'Cancel';
          btn.disabled = false;
        }, 3000);
      }
    }

    loadHolds();
  </script>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Library Checker running at http://localhost:${PORT}`);
});
