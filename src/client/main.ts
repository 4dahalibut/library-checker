interface Book {
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
}

interface Stats {
  total: number;
  available: number;
  unavailable: number;
  notFound: number;
  unchecked: number;
}

interface Genre {
  genre: string;
  count: number;
}

let allBooks: Book[] = [];
let stats: Stats = { total: 0, available: 0, unavailable: 0, notFound: 0, unchecked: 0 };
let genres: Genre[] = [];
let currentFilter = "all";
let currentSort = "date";
let currentGenre: string | null = null;
let currentCulture: string | null = null;

async function loadBooks() {
  const res = await fetch("/api/books");
  const data = await res.json();
  allBooks = data.books || [];
  stats = data.stats || {};
  genres = data.genres || [];
  render();
}

function render() {
  let filtered = filterBooks(allBooks, currentFilter);
  if (currentGenre) {
    filtered = filtered.filter((b) => {
      const bookGenres = b.genres ? JSON.parse(b.genres) : [];
      return bookGenres.includes(currentGenre);
    });
  }
  if (currentCulture) {
    filtered = filtered.filter((b) => b.culture === currentCulture);
  }
  filtered = sortBooks(filtered, currentSort);

  document.getElementById("app")!.innerHTML = `
    <center>
    <table border="0" cellpadding="5">
      <tr>
        <td align="center"><font color="green" size="+2"><b>${stats.available || 0}</b></font><br><font size="2">Available</font></td>
        <td align="center"><font color="#cc9900" size="+2"><b>${stats.unavailable || 0}</b></font><br><font size="2">Checked Out</font></td>
        <td align="center"><font color="red" size="+2"><b>${stats.notFound || 0}</b></font><br><font size="2">Not Found</font></td>
        <td align="center"><font color="gray" size="+2"><b>${stats.unchecked || 0}</b></font><br><font size="2">Unchecked</font></td>
        <td align="center"><font size="+2"><b>${stats.total || 0}</b></font><br><font size="2">Total</font></td>
      </tr>
    </table>
    </center>

    <hr>

    <center>
    <font size="2">
    <b>Filter:</b>
    ${["all", "physical", "pinned", "available", "squirrel-hill", "unavailable", "not-found", "unchecked"]
      .map((f) => (currentFilter === f ? `[<b>${f}</b>]` : `<a href="#" onclick="setFilter('${f}'); return false;">${f}</a>`))
      .join(" | ")}
    <br>
    <b>Sort:</b>
    ${["date", "popularity", "rating", "copies"]
      .map((s) => (currentSort === s ? `[<b>${s}</b>]` : `<a href="#" onclick="setSort('${s}'); return false;">${s}</a>`))
      .join(" | ")}
    </font>
    </center>

    <hr>

    <center>
    <form onsubmit="addByISBN(); return false;">
      <font size="2">Add book by ISBN:</font>
      <input type="text" id="isbn-input" size="20">
      <input type="submit" value="Add">
      <font size="2" id="add-status"></font>
    </form>
    </center>

    <hr>

    ${
      genres.length > 0
        ? `
    <center>
    <font size="2">
    <b>Genres:</b>
    ${!currentGenre ? "[<b>All</b>]" : '<a href="#" onclick="setGenre(null); return false;">All</a>'} |
    ${genres
      .slice(0, 15)
      .map((g) =>
        currentGenre === g.genre
          ? `[<b>${g.genre}</b> (${g.count})]`
          : `<a href="#" onclick="setGenre('${g.genre}'); return false;">${g.genre}</a> (${g.count})`
      )
      .join(" | ")}
    </font>
    </center>
    <br>
    `
        : ""
    }

    ${
      getCultureCounts().length > 0
        ? `
    <center>
    <font size="2">
    <b>Cultures:</b>
    ${!currentCulture ? "[<b>All</b>]" : '<a href="#" onclick="setCulture(null); return false;">All</a>'} |
    ${getCultureCounts()
      .map((c) =>
        currentCulture === c.culture
          ? `[<b>${c.culture}</b> (${c.count})]`
          : `<a href="#" onclick="setCulture('${c.culture}'); return false;">${c.culture}</a> (${c.count})`
      )
      .join(" | ")}
    </font>
    </center>
    <br>
    `
        : ""
    }

    <table border="1" cellpadding="8" cellspacing="0" bgcolor="#ffffff">
      <tr bgcolor="#cccccc">
        <th align="left"><font face="Times New Roman, serif">Title</font></th>
        <th align="left"><font face="Times New Roman, serif">Author</font></th>
        <th align="center"><font face="Times New Roman, serif">Status</font></th>
        <th align="center"><font face="Times New Roman, serif">Info</font></th>
        <th align="center"><font face="Times New Roman, serif">Links</font></th>
        <th align="center"><font face="Times New Roman, serif">Actions</font></th>
      </tr>
      ${filtered.map(renderBook).join("")}
    </table>

    <hr>

    <font size="2" face="Courier New, monospace">
    <b>Commands:</b><br>
    npm run import - Import from Goodreads CSV<br>
    npm run refresh:library 200 - Check library<br>
    npm run refresh:ratings 200 - Fetch ratings<br>
    npm run refresh:genres 200 - Fetch genres
    </font>

    <hr>
    <center>
    <font size="1" face="Times New Roman, serif">
    <i>Last updated: ${new Date().toLocaleDateString()}</i>
    </font>
    </center>
  `;
}

function isEbook(book: Book): boolean {
  return !!(book.libraryFormat && (book.libraryFormat.toLowerCase().includes("ebook") || book.libraryFormat.toLowerCase().includes("e-book")));
}

function filterBooks(books: Book[], filter: string): Book[] {
  switch (filter) {
    case "physical":
      return books.filter((b) => b.libraryStatus && b.libraryStatus !== "NOT_FOUND" && !isEbook(b));
    case "pinned":
      return books.filter((b) => b.pinned);
    case "available":
      return books.filter((b) => b.libraryStatus === "AVAILABLE" && !isEbook(b));
    case "squirrel-hill":
      return books.filter((b) => b.squirrelHillAvailable && !isEbook(b));
    case "unavailable":
      return books.filter((b) => b.libraryStatus === "UNAVAILABLE" && !isEbook(b));
    case "not-found":
      return books.filter((b) => b.libraryStatus === "NOT_FOUND" || isEbook(b));
    case "unchecked":
      return books.filter((b) => !b.libraryStatus);
    default:
      return books;
  }
}

function sortBooks(books: Book[], sort: string): Book[] {
  switch (sort) {
    case "popularity":
      return [...books].sort((a, b) => (b.numRatings || 0) - (a.numRatings || 0));
    case "rating":
      return [...books].sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
    case "copies":
      return [...books].sort((a, b) => (b.totalCopies || 0) - (a.totalCopies || 0));
    default:
      return [...books].sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
  }
}

function setFilter(f: string) {
  currentFilter = f;
  render();
}

function setSort(s: string) {
  currentSort = s;
  render();
}

function setGenre(g: string | null) {
  currentGenre = g;
  render();
}

function setCulture(c: string | null) {
  currentCulture = c;
  render();
}

function getCultureCounts(): { culture: string; count: number }[] {
  const counts: Record<string, number> = {};
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
  const input = document.getElementById("isbn-input") as HTMLInputElement;
  const status = document.getElementById("add-status")!;
  const isbn = input.value.trim().replace(/-/g, "");
  if (!isbn) return;

  status.textContent = "Looking up...";
  try {
    const res = await fetch("/api/add-isbn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isbn }),
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = "Added: " + data.title;
      input.value = "";
      loadBooks();
    } else {
      status.textContent = data.error || "Not found";
    }
  } catch {
    status.textContent = "Error adding book";
  }
}

async function deleteBookById(bookId: string) {
  if (!confirm("Delete this book?")) return;
  try {
    await fetch("/api/book/" + encodeURIComponent(bookId), { method: "DELETE" });
    allBooks = allBooks.filter((b) => b.bookId !== bookId);
    render();
  } catch (e) {
    console.error(e);
  }
}

async function togglePinBook(bookId: string) {
  try {
    const res = await fetch("/api/pin/" + encodeURIComponent(bookId), { method: "POST" });
    const data = await res.json();
    const idx = allBooks.findIndex((b) => b.bookId === bookId);
    if (idx >= 0) allBooks[idx].pinned = data.pinned;
    render();
  } catch (e) {
    console.error(e);
  }
}

async function refreshBook(bookId: string, event: Event) {
  const btn = event.target as HTMLInputElement;
  btn.disabled = true;
  btn.value = "...";
  try {
    const res = await fetch("/api/refresh/" + bookId, { method: "POST" });
    const updated = await res.json();
    const idx = allBooks.findIndex((b) => b.bookId === bookId);
    if (idx >= 0) allBooks[idx] = { ...allBooks[idx], ...updated };
    render();
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    btn.value = "Refresh";
  }
}

async function holdBook(bibId: string, event: Event) {
  const btn = event.target as HTMLInputElement;
  btn.disabled = true;
  btn.value = "...";
  try {
    const res = await fetch("/api/hold/" + bibId, { method: "POST" });
    const result = await res.json();
    if (result.success) {
      btn.value = "OK!";
    } else {
      alert(result.message);
      btn.value = "Hold";
      btn.disabled = false;
    }
  } catch (e) {
    console.error(e);
    alert("Error placing hold");
    btn.value = "Hold";
    btn.disabled = false;
  }
}

function renderBook(book: Book): string {
  let statusColor = "gray";
  let statusText = "Unchecked";
  let copiesText = "";
  let holdsText = "";

  const ebook = !!(book.libraryFormat && (book.libraryFormat.toLowerCase().includes("ebook") || book.libraryFormat.toLowerCase().includes("e-book")));

  if (ebook) {
    statusColor = "red";
    statusText = "eBook Only";
  } else if (book.libraryStatus === "AVAILABLE") {
    statusColor = "green";
    statusText = "AVAILABLE";
    copiesText = `${book.availableCopies}/${book.totalCopies} copies`;
  } else if (book.libraryStatus === "UNAVAILABLE") {
    statusColor = "#cc9900";
    statusText = "Checked Out";
    copiesText = `0/${book.totalCopies} copies`;
  } else if (book.libraryStatus === "NOT_FOUND") {
    statusColor = "red";
    statusText = "Not Found";
  }

  if (book.heldCopies && book.heldCopies > 0) {
    holdsText = `(${book.heldCopies} holds)`;
  }

  const dateAdded = book.dateAdded ? new Date(book.dateAdded).toLocaleDateString() : "";
  const ratingInfo = book.avgRating ? `${book.avgRating.toFixed(1)} stars` : "";
  const numRatingsInfo = book.numRatings ? `${book.numRatings.toLocaleString()} ratings` : "";

  const isbn = book.isbn13 || book.isbn;
  const bibId = book.catalogUrl ? book.catalogUrl.split("/").pop() : null;

  return `
    <tr${book.pinned ? ' bgcolor="#ffffcc"' : ""}>
      <td>
        <font face="Times New Roman, serif">
          ${book.pinned ? "<b>* " : ""}${escapeHtml(book.title)}${book.pinned ? "</b>" : ""}
        </font>
      </td>
      <td><font face="Times New Roman, serif" size="2">${escapeHtml(book.author || "")}</font></td>
      <td align="center">
        <font color="${statusColor}"><b>${statusText}</b></font>
        ${copiesText ? `<br><font size="1">${copiesText}</font>` : ""}
        ${holdsText ? `<br><font size="1" color="orange">${holdsText}</font>` : ""}
        ${book.squirrelHillAvailable ? '<br><font size="1" color="blue">@ Squirrel Hill</font>' : ""}
      </td>
      <td align="center">
        <font size="1">
          ${dateAdded ? `Added: ${dateAdded}<br>` : ""}
          ${ratingInfo ? `${ratingInfo}<br>` : ""}
          ${numRatingsInfo ? `${numRatingsInfo}<br>` : ""}
          ${book.libraryFormat ? `Format: ${book.libraryFormat}` : ""}
        </font>
      </td>
      <td align="center">
        <font size="2">
          <a href="https://www.goodreads.com/book/show/${book.bookId}" target="_blank">Goodreads</a>
          ${book.catalogUrl ? `<br><a href="${book.catalogUrl}" target="_blank">Library</a>` : ""}
          ${isbn ? `<br><a href="https://www.thriftbooks.com/browse/?b.search=${isbn}" target="_blank">ThriftBooks</a>` : ""}
        </font>
      </td>
      <td align="center">
        <input type="button" value="${book.pinned ? "Unpin" : "Pin"}" onclick="togglePinBook('${book.bookId}')" style="font-size:10px">
        <input type="button" value="Refresh" onclick="refreshBook('${book.bookId}', event)" style="font-size:10px">
        ${bibId && !ebook ? `<input type="button" value="Hold" onclick="holdBook('${bibId}', event)" style="font-size:10px">` : ""}
        <input type="button" value="X" onclick="deleteBookById('${book.bookId}')" style="font-size:10px" title="Delete">
      </td>
    </tr>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Expose functions to global scope for onclick handlers
declare global {
  interface Window {
    setFilter: typeof setFilter;
    setSort: typeof setSort;
    setGenre: typeof setGenre;
    setCulture: typeof setCulture;
    addByISBN: typeof addByISBN;
    deleteBookById: typeof deleteBookById;
    togglePinBook: typeof togglePinBook;
    refreshBook: typeof refreshBook;
    holdBook: typeof holdBook;
  }
}

window.setFilter = setFilter;
window.setSort = setSort;
window.setGenre = setGenre;
window.setCulture = setCulture;
window.addByISBN = addByISBN;
window.deleteBookById = deleteBookById;
window.togglePinBook = togglePinBook;
window.refreshBook = refreshBook;
window.holdBook = holdBook;

loadBooks();
