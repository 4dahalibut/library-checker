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

interface Recommendation {
  id: number;
  title: string;
  author: string | null;
  recommendedBy: string;
  createdAt: string;
}

let allBooks: Book[] = [];
let recommendations: Recommendation[] = [];
let stats: Stats = { total: 0, available: 0, unavailable: 0, notFound: 0, unchecked: 0 };
let genres: Genre[] = [];
let currentFilter = "all";
let currentSort = "date";
let currentGenre: string | null = null;
let currentCulture: string | null = null;
let searchQuery = "";
let isLoggedIn = false;
let loggedInUsername: string | null = null;

// URL parsing: detect /u/:username
const pathMatch = window.location.pathname.match(/^\/u\/([^/]+)/);
const profileUsername: string | null = pathMatch ? pathMatch[1] : null;
let isOwnProfile = false;

async function loadBooks() {
  // Get auth status first
  const statusRes = await fetch("/api/status");
  const statusData = await statusRes.json();
  isLoggedIn = statusData.authenticated || false;
  loggedInUsername = statusData.username || null;

  // If at root and logged in, redirect to own profile
  if (!profileUsername && isLoggedIn && loggedInUsername) {
    window.location.href = `/u/${loggedInUsername}`;
    return;
  }

  // If at root and not logged in, show landing page
  if (!profileUsername) {
    isOwnProfile = false;
    renderLanding();
    return;
  }

  // On a user profile page
  isOwnProfile = isLoggedIn && loggedInUsername?.toLowerCase() === profileUsername.toLowerCase();

  const [booksRes, recsRes] = await Promise.all([
    fetch(`/api/u/${profileUsername}/books`),
    fetch(`/api/u/${profileUsername}/recommendations`),
  ]);

  if (!booksRes.ok) {
    document.getElementById("app")!.innerHTML = `<center><h2>User "${escapeHtml(profileUsername)}" not found</h2><br><a href="/">[Home]</a></center>`;
    return;
  }

  const booksData = await booksRes.json();
  const recsData = await recsRes.json();
  allBooks = booksData.books || [];
  stats = booksData.stats || {};
  genres = booksData.genres || [];
  recommendations = recsData.recommendations || [];

  // Update page title
  document.title = `${profileUsername}'s Book List`;
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = `${profileUsername}'s Book List`;

  render();
}

function renderLanding() {
  document.getElementById("app")!.innerHTML = `
    <center>
    <h2>Login</h2>
    <form id="login-form" class="add-form">
      <input type="text" id="login-username" class="add-input" placeholder="Username" style="margin-bottom:5px;">
      <input type="password" id="login-password" class="add-input" placeholder="Password" style="margin-bottom:5px;">
      <input type="submit" value="Login">
      <div id="login-error" style="color: red; font-size: 12px; margin-top: 5px;"></div>
    </form>

    <hr>

    <h2>Create Account</h2>
    <form id="register-form" class="add-form">
      <input type="text" id="register-username" class="add-input" placeholder="Username" style="margin-bottom:5px;">
      <input type="password" id="register-password" class="add-input" placeholder="Password" style="margin-bottom:5px;">
      <input type="submit" value="Register">
      <div id="register-error" style="color: red; font-size: 12px; margin-top: 5px;"></div>
    </form>
    </center>
  `;

  document.getElementById("login-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = (document.getElementById("login-username") as HTMLInputElement).value;
    const password = (document.getElementById("login-password") as HTMLInputElement).value;
    const errorEl = document.getElementById("login-error")!;

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = `/u/${data.username}`;
      } else {
        errorEl.textContent = data.error || "Login failed";
      }
    } catch {
      errorEl.textContent = "Login failed";
    }
  });

  document.getElementById("register-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = (document.getElementById("register-username") as HTMLInputElement).value;
    const password = (document.getElementById("register-password") as HTMLInputElement).value;
    const errorEl = document.getElementById("register-error")!;

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = `/u/${data.username}`;
      } else {
        errorEl.textContent = data.error || "Registration failed";
      }
    } catch {
      errorEl.textContent = "Registration failed";
    }
  });
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

  const navLinks = [];
  if (profileUsername) {
    navLinks.push(`<a href="/u/${escapeHtml(profileUsername)}/finished">[Finished Books]</a>`);
  }
  if (isLoggedIn) {
    navLinks.push(`<a href="/holds.html">[My Holds]</a>`);
  }

  document.getElementById("app")!.innerHTML = `
    ${isLoggedIn ? `
    <center><a href="#" onclick="doLogout(); return false;">[Logout${loggedInUsername ? ' ' + escapeHtml(loggedInUsername) : ''}]</a>${!isOwnProfile && loggedInUsername ? ` | <a href="/u/${escapeHtml(loggedInUsername)}">[My List]</a>` : ''}</center>
    <hr>
    ` : ""}

    ${navLinks.length > 0 ? `<center>${navLinks.join(" | ")}</center><hr>` : ""}

    ${!isOwnProfile ? `
    <center><h3>Recommend a Book</h3></center>
    <form class="add-form" onsubmit="submitRecommendation(); return false;">
      <font size="2">Suggest a book for ${escapeHtml(profileUsername || "this user")} to read:</font><br>
      <input type="text" id="rec-title" class="add-input" placeholder="Book title" style="margin-bottom:5px;">
      <input type="text" id="rec-author" class="add-input" placeholder="Author (optional)" style="margin-bottom:5px;">
      <input type="text" id="rec-name" class="add-input" placeholder="Your name">
      <input type="submit" value="Recommend">
      <div id="rec-status" style="font-size:12px; margin-top:5px;"></div>
    </form>

    ${recommendations.length > 0 ? `
    <br>
    <center><b>Recommendations from friends:</b></center>
    <div class="table-scroll">
    <table class="data-table">
      <tr bgcolor="#cccccc">
        <th align="left">Title</th>
        <th align="left">Author</th>
        <th align="left">Recommended by</th>
      </tr>
      ${recommendations.map(r => `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td><font size="2">${escapeHtml(r.author || "")}</font></td>
          <td><font size="2">${escapeHtml(r.recommendedBy)}</font></td>
        </tr>
      `).join("")}
    </table>
    </div>
    ` : ""}

    <hr>
    ` : `
    ${recommendations.length > 0 ? `
    <center><b>Recommendations from friends:</b></center>
    <div class="table-scroll">
    <table class="data-table">
      <tr bgcolor="#cccccc">
        <th align="left">Title</th>
        <th align="left">Author</th>
        <th align="left">Recommended by</th>
        <th></th>
      </tr>
      ${recommendations.map(r => `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td><font size="2">${escapeHtml(r.author || "")}</font></td>
          <td><font size="2">${escapeHtml(r.recommendedBy)}</font></td>
          <td><input type="button" class="action-btn" value="X" onclick="deleteRecommendation(${r.id})" title="Delete" style="font-size:10px; padding:2px 6px;"></td>
        </tr>
      `).join("")}
    </table>
    </div>
    <hr>
    ` : ""}
    `}

    <center>
    <table class="stats-table" border="0" cellpadding="5">
      <tr>
        <td><font color="green" size="+2"><b>${stats.available || 0}</b></font><br><font size="2">Available</font></td>
        <td><font color="#cc9900" size="+2"><b>${stats.unavailable || 0}</b></font><br><font size="2">Checked Out</font></td>
        <td><font color="red" size="+2"><b>${stats.notFound || 0}</b></font><br><font size="2">Not Found</font></td>
        <td><font color="gray" size="+2"><b>${stats.unchecked || 0}</b></font><br><font size="2">Unchecked</font></td>
        <td><font size="+2"><b>${stats.total || 0}</b></font><br><font size="2">Total</font></td>
      </tr>
    </table>
    </center>

    <hr>

    <div class="controls">
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
    <input type="text" id="search-input" class="search-input" placeholder="Search by title or author..." value="${escapeHtml(searchQuery)}" oninput="handleSearch(this.value)">
    ${searchQuery ? `<a href="#" onclick="handleSearch(''); return false;">[clear]</a>` : ""}
    </div>

    <hr>

    ${isOwnProfile ? `
    <form class="add-form" onsubmit="addBook(); return false;">
      <font size="2">Add book (ISBN or keyword):</font><br>
      <input type="text" id="add-input" class="add-input" placeholder="ISBN or title...">
      <input type="submit" value="Add">
      <div id="add-status" style="font-size:12px; margin-top:5px;"></div>
    </form>

    <hr>
    ` : ""}

    ${
      genres.length > 0
        ? `
    <div class="filter-section">
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
    </div>
    `
        : ""
    }

    ${
      getCultureCounts().length > 0
        ? `
    <div class="filter-section">
    <b>Cultures:</b>
    ${!currentCulture ? "[<b>All</b>]" : '<a href="#" onclick="setCulture(null); return false;">All</a>'} |
    ${getCultureCounts()
      .map((c) =>
        currentCulture === c.culture
          ? `[<b>${c.culture}</b> (${c.count})]`
          : `<a href="#" onclick="setCulture('${c.culture}'); return false;">${c.culture}</a> (${c.count})`
      )
      .join(" | ")}
    </div>
    `
        : ""
    }

    <div class="table-scroll">
    <table class="data-table">
      <tr bgcolor="#cccccc">
        <th align="left">Title</th>
        <th align="left">Author</th>
        <th align="center">Year</th>
        <th align="center">Status</th>
        <th align="center">Info</th>
        <th align="center">Links</th>
        ${isOwnProfile ? `<th align="center">Actions</th>` : ""}
      </tr>
      ${filtered.map(renderBook).join("")}
    </table>
    </div>

    <hr>

    <div class="footer">
    <i>Last updated: ${new Date().toLocaleDateString()}</i>
    </div>
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

  const cleanedQuery = query.replace(/-/g, "");
  const isISBN = /^\d{10}(\d{3})?$/.test(cleanedQuery);

  status.textContent = "Looking up...";
  try {
    const res = await fetch("/api/add-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isISBN ? { isbn: cleanedQuery } : { keyword: query }),
    });
    if (res.status === 401) {
      status.textContent = "Please log in first";
      return;
    }
    const data = await res.json();
    if (data.success) {
      status.textContent = "Added: " + data.title;
      input.value = "";
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
    const res = await fetch("/api/book/" + encodeURIComponent(bookId), { method: "DELETE" });
    if (res.status === 401) return;
    allBooks = allBooks.filter((b) => b.bookId !== bookId);
    render();
  } catch (e) {
    console.error(e);
  }
}

async function deleteRecommendation(id: number) {
  if (!confirm("Delete this recommendation?")) return;
  try {
    const res = await fetch("/api/recommendations/" + id, { method: "DELETE" });
    if (res.ok) {
      recommendations = recommendations.filter(r => r.id !== id);
      render();
    }
  } catch (e) {
    console.error(e);
  }
}

async function togglePinBook(bookId: string) {
  try {
    const res = await fetch("/api/pin/" + encodeURIComponent(bookId), { method: "POST" });
    if (res.status === 401) return;
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
    if (res.status === 401) {
      btn.disabled = false;
      btn.value = "Refresh";
      return;
    }
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

    showEditionsModal(title, editions, btn);
  } catch (e) {
    console.error(e);
    alert("Error searching for editions");
    btn.value = "Hold";
    btn.disabled = false;
  }
}

function showEditionsModal(bookTitle: string, editions: Edition[], holdBtn: HTMLInputElement) {
  const existing = document.getElementById("editions-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "editions-modal";
  modal.className = "modal-overlay";

  const formatBranches = (branches: Edition["branches"]) => {
    return branches.map(b => {
      let text = b.name;
      if (b.status === "AVAILABLE") {
        text += ' <font color="green">Available</font>';
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
    <div class="modal-content">
      <h3 style="margin-top: 0;">${escapeHtml(bookTitle)} - ${editions.length} edition${editions.length === 1 ? "" : "s"} found</h3>
      <form id="edition-form">
        <div class="table-scroll">
        <table class="data-table">
          <tr bgcolor="#cccccc">
            <th width="30"></th>
            <th align="left">Edition</th>
            <th align="center">Status</th>
            <th align="left">Branches</th>
          </tr>
          ${editionRows}
        </table>
        </div>
        <div class="modal-buttons">
          <input type="submit" value="Place Hold">
          <input type="button" value="Cancel" onclick="closeEditionsModal()">
        </div>
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
    <tr${book.pinned ? ' class="row-pinned"' : ""}>
      <td>
        ${book.pinned ? "<b>* " : ""}${escapeHtml(book.title)}${book.pinned ? "</b>" : ""}
        ${isOwnProfile ? `<br><input type="text" class="notes-input" placeholder="Add notes..." value="${escapeHtml(book.notes || "")}" onchange="saveNotes('${book.bookId}', this.value)">` : (book.notes ? `<br><font size="1" color="#666"><i>${escapeHtml(book.notes)}</i></font>` : "")}
      </td>
      <td><font size="2">${escapeHtml(book.author || "")}</font></td>
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
      ${isOwnProfile ? `
      <td align="center" style="white-space:nowrap">
        <input type="button" class="action-btn" value="${book.pinned ? "Unpin" : "Pin"}" onclick="togglePinBook('${book.bookId}')">
        <input type="button" class="action-btn" value="Refresh" onclick="refreshBook('${book.bookId}', event)">
        ${!isNotPhysicalBook(book) && book.libraryStatus && book.libraryStatus !== "NOT_FOUND" ? `<input type="button" class="action-btn" value="Hold" onclick="holdBook('${escapeHtml(book.title.replace(/'/g, "\\\'"))}', '${escapeHtml((book.author || "").replace(/'/g, "\\\'"))}', event)">` : ""}
        <input type="button" class="action-btn" value="X" onclick="deleteBookById('${book.bookId}')" title="Remove from list">
      </td>
      ` : ""}
    </tr>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  isLoggedIn = false;
  loggedInUsername = null;
  isOwnProfile = false;
  if (!profileUsername) {
    renderLanding();
  } else {
    render();
  }
}

async function submitRecommendation() {
  const titleInput = document.getElementById("rec-title") as HTMLInputElement;
  const authorInput = document.getElementById("rec-author") as HTMLInputElement;
  const nameInput = document.getElementById("rec-name") as HTMLInputElement;
  const status = document.getElementById("rec-status")!;

  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  const recommendedBy = nameInput.value.trim();

  if (!title || !recommendedBy) {
    status.textContent = "Please enter a title and your name";
    return;
  }

  status.textContent = "Submitting...";
  try {
    const res = await fetch(`/api/u/${profileUsername}/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, author: author || null, recommendedBy }),
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = "Thanks for the recommendation!";
      titleInput.value = "";
      authorInput.value = "";
      nameInput.value = "";
      recommendations.unshift(data.recommendation);
      render();
    } else {
      status.textContent = data.error || "Error submitting";
    }
  } catch {
    status.textContent = "Error submitting recommendation";
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
    deleteRecommendation: typeof deleteRecommendation;
    togglePinBook: typeof togglePinBook;
    refreshBook: typeof refreshBook;
    holdBook: typeof holdBook;
    saveNotes: typeof saveNotes;
    closeEditionsModal: typeof closeEditionsModal;
    submitRecommendation: typeof submitRecommendation;
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
window.deleteRecommendation = deleteRecommendation;
window.togglePinBook = togglePinBook;
window.refreshBook = refreshBook;
window.holdBook = holdBook;
window.saveNotes = saveNotes;
window.closeEditionsModal = closeEditionsModal;
window.submitRecommendation = submitRecommendation;
window.doLogout = doLogout;

loadBooks();
