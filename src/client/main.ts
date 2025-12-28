interface Edition {
  bibId: string;
  title: string;
  subtitle?: string;
  author: string;
  format: string;
  year?: string;
  series?: string;
  translator?: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  availableCopies: number;
  totalCopies: number;
  heldCopies: number;
  branches: { name: string; status: string; dueDate?: string }[];
}

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
  notes: string | null;
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
let searchQuery = "";

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
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (b) => b.title.toLowerCase().includes(q) || (b.author && b.author.toLowerCase().includes(q))
    );
  }
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
    <br><br>
    <b>Search:</b>
    <input type="text" id="search-input" size="30" placeholder="Search by title or author..." value="${escapeHtml(searchQuery)}" oninput="handleSearch(this.value)">
    ${searchQuery ? `<a href="#" onclick="handleSearch(''); return false;">[clear]</a>` : ""}
    </font>
    </center>

    <hr>

    <center>
    <form onsubmit="addBook(); return false;">
      <font size="2">Add book (ISBN or keyword):</font>
      <input type="text" id="add-input" size="25">
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
        <th align="center"><font face="Times New Roman, serif">Year</font></th>
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
    &nbsp;|&nbsp;
    <a href="#" onclick="doLogout(); return false;">Logout</a>
    </font>
    </center>
  `;
}

function isNotPhysicalBook(book: Book): boolean {
  if (!book.libraryFormat) return false;
  const format = book.libraryFormat.toLowerCase();
  return format.includes("ebook") || format.includes("e-book") || format.includes("audiobook") || format === "book_cd";
}

function filterBooks(books: Book[], filter: string): Book[] {
  switch (filter) {
    case "physical":
      return books.filter((b) => b.libraryStatus && b.libraryStatus !== "NOT_FOUND" && !isNotPhysicalBook(b));
    case "pinned":
      return books.filter((b) => b.pinned);
    case "available":
      return books.filter((b) => b.libraryStatus === "AVAILABLE" && !isNotPhysicalBook(b));
    case "squirrel-hill":
      return books.filter((b) => b.squirrelHillAvailable && !isNotPhysicalBook(b));
    case "unavailable":
      return books.filter((b) => b.libraryStatus === "UNAVAILABLE" && !isNotPhysicalBook(b));
    case "not-found":
      return books.filter((b) => b.libraryStatus === "NOT_FOUND" || isNotPhysicalBook(b));
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

function handleSearch(query: string) {
  searchQuery = query;
  render();
  // Restore focus to search input after re-render
  const input = document.getElementById("search-input") as HTMLInputElement;
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
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

async function addBook() {
  const input = document.getElementById("add-input") as HTMLInputElement;
  const status = document.getElementById("add-status")!;
  const query = input.value.trim();
  if (!query) return;

  // Check if it looks like an ISBN (10 or 13 digits, possibly with hyphens)
  const cleanedQuery = query.replace(/-/g, "");
  const isISBN = /^\d{10}(\d{3})?$/.test(cleanedQuery);

  status.textContent = "Looking up...";
  try {
    const res = await fetch("/api/add-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isISBN ? { isbn: cleanedQuery } : { keyword: query }),
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = "Added: " + data.title;
      input.value = "";
      // Reset filters and scroll to top to see the new book
      currentFilter = "all";
      currentSort = "date";
      currentGenre = null;
      currentCulture = null;
      searchQuery = "";
      await loadBooks();
      window.scrollTo(0, 0);
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

async function holdBook(title: string, author: string, event: Event) {
  const btn = event.target as HTMLInputElement;
  btn.disabled = true;
  btn.value = "...";

  try {
    // Search for all editions
    const query = `${title} ${author}`;
    const res = await fetch(`/api/editions?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const editions: Edition[] = data.editions || [];

    if (editions.length === 0) {
      alert("No editions found in library");
      btn.value = "Hold";
      btn.disabled = false;
      return;
    }

    // Show modal with editions
    showEditionsModal(title, editions, btn);
  } catch (e) {
    console.error(e);
    alert("Error searching for editions");
    btn.value = "Hold";
    btn.disabled = false;
  }
}

function showEditionsModal(bookTitle: string, editions: Edition[], holdBtn: HTMLInputElement) {
  // Remove existing modal if any
  const existing = document.getElementById("editions-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "editions-modal";
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  `;

  const formatBranches = (branches: Edition["branches"]) => {
    return branches.map(b => {
      let text = b.name;
      if (b.status === "AVAILABLE") {
        text += ' <font color="green">✓ Available</font>';
      } else if (b.dueDate) {
        const due = new Date(b.dueDate);
        text += ` <font color="#cc9900">due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</font>`;
      } else {
        text += ` <font color="gray">${b.status}</font>`;
      }
      return text;
    }).join("<br>");
  };

  const editionRows = editions.map((ed, i) => {
    const statusColor = ed.status === "AVAILABLE" ? "green" : "#cc9900";
    const statusText = ed.status === "AVAILABLE"
      ? `${ed.availableCopies} available`
      : `Checked out${ed.heldCopies ? ` (${ed.heldCopies} holds)` : ""}`;

    // Build edition description with subtitle, series, year, translator
    let editionDesc = escapeHtml(ed.title);
    if (ed.subtitle) {
      editionDesc += `<br><font size="1" color="#666">${escapeHtml(ed.subtitle)}</font>`;
    }
    const details: string[] = [];
    if (ed.year) details.push(ed.year);
    if (ed.series) details.push(ed.series);
    if (ed.translator) details.push(`trans. ${ed.translator}`);
    if (details.length > 0) {
      editionDesc += `<br><font size="1" color="gray">${escapeHtml(details.join(" · "))}</font>`;
    }

    return `
      <tr${ed.status === "AVAILABLE" ? ' bgcolor="#eeffee"' : ""}>
        <td><input type="radio" name="edition" value="${ed.bibId}" ${i === 0 ? "checked" : ""}></td>
        <td>
          <font size="2"><b>${editionDesc}</b></font>
        </td>
        <td align="center">
          <font color="${statusColor}" size="2"><b>${statusText}</b></font><br>
          <font size="1">${ed.totalCopies} total</font>
        </td>
        <td><font size="1">${formatBranches(ed.branches)}</font></td>
      </tr>
    `;
  }).join("");

  modal.innerHTML = `
    <div style="background: white; padding: 20px; max-width: 800px; max-height: 80vh; overflow-y: auto; border: 2px solid black;">
      <h3 style="margin-top: 0;">${escapeHtml(bookTitle)} - ${editions.length} edition${editions.length === 1 ? "" : "s"} found</h3>
      <form id="edition-form">
        <table border="1" cellpadding="5" cellspacing="0" width="100%">
          <tr bgcolor="#cccccc">
            <th width="30"></th>
            <th align="left">Edition</th>
            <th align="center">Status</th>
            <th align="left">Branches</th>
          </tr>
          ${editionRows}
        </table>
        <br>
        <center>
          <input type="submit" value="Place Hold" style="font-size: 14px; padding: 5px 20px;">
          <input type="button" value="Cancel" onclick="closeEditionsModal()" style="font-size: 14px; padding: 5px 20px;">
        </center>
      </form>
    </div>
  `;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeEditionsModal();
  });

  const form = modal.querySelector("#edition-form") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const bibId = formData.get("edition") as string;

    const submitBtn = form.querySelector('input[type="submit"]') as HTMLInputElement;
    submitBtn.disabled = true;
    submitBtn.value = "Placing hold...";

    try {
      const res = await fetch("/api/hold/" + bibId, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        holdBtn.value = "OK!";
        closeEditionsModal();
      } else {
        alert(result.message);
        submitBtn.disabled = false;
        submitBtn.value = "Place Hold";
      }
    } catch (err) {
      console.error(err);
      alert("Error placing hold");
      submitBtn.disabled = false;
      submitBtn.value = "Place Hold";
    }
  });

  document.body.appendChild(modal);
}

function closeEditionsModal() {
  const modal = document.getElementById("editions-modal");
  if (modal) {
    modal.remove();
    // Re-enable hold buttons
    const holdBtns = document.querySelectorAll('input[value="..."]') as NodeListOf<HTMLInputElement>;
    holdBtns.forEach(btn => {
      btn.value = "Hold";
      btn.disabled = false;
    });
  }
}

async function saveNotes(bookId: string, notes: string) {
  try {
    await fetch("/api/notes/" + encodeURIComponent(bookId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    const idx = allBooks.findIndex((b) => b.bookId === bookId);
    if (idx >= 0) allBooks[idx].notes = notes;
  } catch (e) {
    console.error(e);
  }
}

function renderBook(book: Book): string {
  let statusColor = "gray";
  let statusText = "Unchecked";
  let copiesText = "";
  let holdsText = "";

  if (isNotPhysicalBook(book)) {
    statusColor = "red";
    statusText = "Digital Only";
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
        <br>
        <input type="text" size="30" placeholder="Add notes..." value="${escapeHtml(book.notes || "")}" onchange="saveNotes('${book.bookId}', this.value)" style="font-size:10px; color:#666;">
      </td>
      <td><font face="Times New Roman, serif" size="2">${escapeHtml(book.author || "")}</font></td>
      <td align="center"><font size="2">${book.publishYear || ""}</font></td>
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
          <a href="${book.bookId.startsWith("manual-") ? `https://www.goodreads.com/search?q=${isbn || encodeURIComponent(book.title)}` : `https://www.goodreads.com/book/show/${book.bookId}`}" target="_blank">Goodreads</a>
          ${book.catalogUrl ? `<br><a href="${book.catalogUrl}" target="_blank">Library</a>` : ""}
          ${isbn ? `<br><a href="https://www.thriftbooks.com/browse/?b.search=${isbn}" target="_blank">ThriftBooks</a>` : ""}
        </font>
      </td>
      <td align="center">
        <input type="button" value="${book.pinned ? "Unpin" : "Pin"}" onclick="togglePinBook('${book.bookId}')" style="font-size:10px">
        <input type="button" value="Refresh" onclick="refreshBook('${book.bookId}', event)" style="font-size:10px">
        ${!isNotPhysicalBook(book) && book.libraryStatus && book.libraryStatus !== "NOT_FOUND" ? `<input type="button" value="Hold" onclick="holdBook('${escapeHtml(book.title.replace(/'/g, "\\\'"))}', '${escapeHtml((book.author || "").replace(/'/g, "\\\'"))}', event)" style="font-size:10px">` : ""}
        <input type="button" value="X" onclick="deleteBookById('${book.bookId}')" style="font-size:10px" title="Delete">
      </td>
    </tr>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderLogin(error?: string) {
  document.getElementById("app")!.innerHTML = `
    <center>
    <br><br>
    <form onsubmit="doLogin(); return false;">
      <table border="0" cellpadding="5">
        <tr>
          <td align="right"><font face="Times New Roman, serif">Username:</font></td>
          <td><input type="text" id="login-username" size="20"></td>
        </tr>
        <tr>
          <td align="right"><font face="Times New Roman, serif">Password:</font></td>
          <td><input type="password" id="login-password" size="20"></td>
        </tr>
        <tr>
          <td></td>
          <td><input type="submit" value="Login"></td>
        </tr>
        ${error ? `<tr><td></td><td><font color="red" size="2">${error}</font></td></tr>` : ""}
      </table>
    </form>
    </center>
  `;
}

async function doLogin() {
  const username = (document.getElementById("login-username") as HTMLInputElement).value;
  const password = (document.getElementById("login-password") as HTMLInputElement).value;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      loadBooks();
    } else {
      renderLogin("Invalid credentials");
    }
  } catch {
    renderLogin("Login failed");
  }
}

async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  renderLogin();
}

async function checkAuth() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.authenticated) {
      loadBooks();
    } else {
      renderLogin();
    }
  } catch {
    renderLogin();
  }
}

// Expose functions to global scope for onclick handlers
declare global {
  interface Window {
    setFilter: typeof setFilter;
    setSort: typeof setSort;
    setGenre: typeof setGenre;
    setCulture: typeof setCulture;
    handleSearch: typeof handleSearch;
    addBook: typeof addBook;
    deleteBookById: typeof deleteBookById;
    togglePinBook: typeof togglePinBook;
    refreshBook: typeof refreshBook;
    holdBook: typeof holdBook;
    saveNotes: typeof saveNotes;
    closeEditionsModal: typeof closeEditionsModal;
    doLogin: typeof doLogin;
    doLogout: typeof doLogout;
  }
}

window.setFilter = setFilter;
window.setSort = setSort;
window.setGenre = setGenre;
window.setCulture = setCulture;
window.handleSearch = handleSearch;
window.addBook = addBook;
window.deleteBookById = deleteBookById;
window.togglePinBook = togglePinBook;
window.refreshBook = refreshBook;
window.holdBook = holdBook;
window.saveNotes = saveNotes;
window.closeEditionsModal = closeEditionsModal;
window.doLogin = doLogin;
window.doLogout = doLogout;

checkAuth();
