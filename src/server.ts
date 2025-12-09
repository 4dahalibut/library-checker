import express from "express";
import { getAllBooks, getStats, getAllGenres, updateLibraryData } from "./db.js";
import { searchLibrary } from "./library.js";

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

    .loading { text-align: center; padding: 40px; color: #888; }
    .commands { background: #16213e; padding: 16px; border-radius: 8px; margin-top: 20px; font-size: 0.9em; }
    .commands code { background: #0f3460; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Library Availability Checker</h1>
  <p class="subtitle">Goodreads "Want to Read" + Carnegie Library of Pittsburgh</p>

  <div id="app"><div class="loading">Loading...</div></div>

  <script>
    let allBooks = [];
    let stats = {};
    let genres = [];
    let currentFilter = 'all';
    let currentSort = 'date';
    let currentGenre = null;

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
          <button class="filter-btn \${currentFilter === 'available' ? 'active' : ''}" onclick="setFilter('available')">Available</button>
          <button class="filter-btn \${currentFilter === 'squirrel-hill' ? 'active' : ''}" onclick="setFilter('squirrel-hill')">Squirrel Hill</button>
          <button class="filter-btn \${currentFilter === 'unavailable' ? 'active' : ''}" onclick="setFilter('unavailable')">Checked Out</button>
          <button class="filter-btn \${currentFilter === 'not-found' ? 'active' : ''}" onclick="setFilter('not-found')">Not Found</button>
          <button class="filter-btn \${currentFilter === 'unchecked' ? 'active' : ''}" onclick="setFilter('unchecked')">Unchecked</button>
          <span class="separator">|</span>
          <button class="filter-btn \${currentSort === 'date' ? 'active' : ''}" onclick="setSort('date')">By Date</button>
          <button class="filter-btn \${currentSort === 'popularity' ? 'active' : ''}" onclick="setSort('popularity')">By Popularity</button>
          <button class="filter-btn \${currentSort === 'rating' ? 'active' : ''}" onclick="setSort('rating')">By Rating</button>
        </div>

        \${genres.length > 0 ? \`
        <div class="genre-filters">
          <button class="genre-btn \${!currentGenre ? 'active' : ''}" onclick="setGenre(null)">All Genres</button>
          \${genres.slice(0, 20).map(g => \`
            <button class="genre-btn \${currentGenre === g.genre ? 'active' : ''}" onclick="setGenre('\${g.genre}')">\${g.genre}<span class="count">(\${g.count})</span></button>
          \`).join('')}
        </div>
        \` : ''}

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

    function filterBooks(books, filter) {
      switch (filter) {
        case 'available': return books.filter(b => b.libraryStatus === 'AVAILABLE');
        case 'squirrel-hill': return books.filter(b => b.squirrelHillAvailable);
        case 'unavailable': return books.filter(b => b.libraryStatus === 'UNAVAILABLE');
        case 'not-found': return books.filter(b => b.libraryStatus === 'NOT_FOUND');
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
        default:
          return [...books].sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
      }
    }

    function setFilter(f) { currentFilter = f; render(); }
    function setSort(s) { currentSort = s; render(); }
    function setGenre(g) { currentGenre = g; render(); }

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

    function renderBook(book) {
      let statusClass = 'unchecked';
      let statusText = 'Unchecked';
      let copiesText = '';
      let holdsText = '';
      let catalogLink = '';

      if (book.libraryStatus === 'AVAILABLE') {
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
      if (book.catalogUrl) {
        catalogLink = \`<a href="\${book.catalogUrl}" target="_blank" class="catalog-link">View in catalog</a>\`;
      }
      const goodreadsLink = \`<a href="https://www.goodreads.com/book/show/\${book.bookId}" target="_blank" class="catalog-link">Goodreads</a>\`;

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
            <button class="refresh-btn" onclick="refreshBook('\${book.bookId}')">↻</button>
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

app.listen(PORT, () => {
  console.log(`Library Checker running at http://localhost:${PORT}`);
});
