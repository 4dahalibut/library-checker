interface FinishedBook {
  id: number;
  title: string;
  author: string | null;
  vibe: string | null;
  review: string | null;
  finishedAt: string;
}

let books: FinishedBook[] = [];
let isLoggedIn = false;
let loggedInUsername: string | null = null;

// URL parsing: detect /u/:username/finished
const pathMatch = window.location.pathname.match(/^\/u\/([^/]+)/);
const profileUsername: string | null = pathMatch ? pathMatch[1] : null;
let isOwnProfile = false;

async function loadBooks() {
  const statusRes = await fetch("/api/status");
  const statusData = await statusRes.json();
  isLoggedIn = statusData.authenticated || false;
  loggedInUsername = statusData.username || null;

  // If no profile username, redirect logged-in users
  if (!profileUsername && isLoggedIn && loggedInUsername) {
    window.location.href = `/u/${loggedInUsername}/finished`;
    return;
  }

  if (!profileUsername) {
    document.getElementById("app")!.innerHTML = '<center><a href="/">Go to home page</a></center>';
    return;
  }

  isOwnProfile = isLoggedIn && loggedInUsername?.toLowerCase() === profileUsername.toLowerCase();

  const booksRes = await fetch(`/api/u/${profileUsername}/finished`);
  if (!booksRes.ok) {
    document.getElementById("app")!.innerHTML = `<center><h2>User "${escapeHtml(profileUsername)}" not found</h2><br><a href="/">[Home]</a></center>`;
    return;
  }
  const booksData = await booksRes.json();
  books = booksData.books || [];

  // Update page title
  document.title = `${profileUsername}'s Finished Books`;
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = `${profileUsername}'s Finished Books`;
  const subtitleEl = document.getElementById("page-subtitle");
  if (subtitleEl) subtitleEl.textContent = "Books read + mini reviews";

  render();
}

function render() {
  const backLink = profileUsername ? `/u/${escapeHtml(profileUsername)}` : "/";

  document.getElementById("app")!.innerHTML = `
    ${isLoggedIn ? `
    <center>
    <input type="button" class="action-btn" value="Logout" onclick="doLogout()">
    </center>
    <hr>
    ` : ""}

    <center><a href="${backLink}">[Back to Book List]</a>${isLoggedIn ? ` | <a href="/holds.html">[My Holds]</a>` : ""}</center>
    <hr>

    ${isOwnProfile ? `
    <center><b>Add finished book:</b></center>
    <form class="add-form" onsubmit="addBook(); return false;">
      <div style="display:flex; gap:10px; margin-bottom:5px;">
        <input type="text" id="add-title" class="add-input" placeholder="Book title" style="flex:2;">
        <input type="text" id="add-author" class="add-input" placeholder="Author" style="flex:1;">
      </div>
      <input type="text" id="add-vibe" class="add-input" placeholder="Vibe check (e.g. cozy, intense, thought-provoking)" style="margin-bottom:5px; width:100%; box-sizing:border-box;">
      <textarea id="add-review" class="add-input" placeholder="Full review (optional)" rows="6" style="margin-bottom:5px; width:100%; box-sizing:border-box;"></textarea>
      <input type="submit" value="Add">
      <div id="add-status" style="font-size:12px; margin-top:5px;"></div>
    </form>
    <hr>
    ` : ""}

    ${books.length === 0 ? `
    <center><i>No finished books yet.</i></center>
    ` : `
    <div class="finished-books">
      ${books.map(renderBook).join("")}
    </div>
    `}
  `;
}

function renderBook(book: FinishedBook): string {
  const date = new Date(book.finishedAt).toLocaleDateString();

  return `
    <div class="finished-book" style="margin-bottom:20px; padding-bottom:20px; border-bottom:1px dashed #999;">
      <div style="margin-bottom:5px;">
        <b>${escapeHtml(book.title)}</b>${book.author ? ` <font color="#666">by ${escapeHtml(book.author)}</font>` : ""}
        ${isOwnProfile ? `<input type="button" class="action-btn" value="X" onclick="deleteBook(${book.id})" title="Delete" style="margin-left:10px; font-size:10px; padding:2px 6px;">` : ""}
      </div>
      ${book.vibe ? `<div style="margin-bottom:5px;"><i>${escapeHtml(book.vibe)}</i></div>` : ""}
      ${book.review ? `<div style="white-space:pre-wrap; margin-bottom:5px;">${escapeHtml(book.review)}</div>` : ""}
      <div><font size="1" color="#888">Finished ${date}</font></div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function addBook() {
  const titleInput = document.getElementById("add-title") as HTMLInputElement;
  const authorInput = document.getElementById("add-author") as HTMLInputElement;
  const vibeInput = document.getElementById("add-vibe") as HTMLInputElement;
  const reviewInput = document.getElementById("add-review") as HTMLTextAreaElement;
  const status = document.getElementById("add-status")!;

  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  const vibe = vibeInput.value.trim();
  const review = reviewInput.value.trim();

  if (!title) {
    status.textContent = "Please enter a title";
    return;
  }

  status.textContent = "Adding...";
  try {
    const res = await fetch("/api/finished", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, author: author || null, vibe: vibe || null, review: review || null }),
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = "Added!";
      titleInput.value = "";
      authorInput.value = "";
      vibeInput.value = "";
      reviewInput.value = "";
      books.unshift(data.book);
      render();
    } else {
      status.textContent = data.error || "Error adding book";
    }
  } catch {
    status.textContent = "Error adding book";
  }
}

async function deleteBook(id: number) {
  if (!confirm("Delete this book?")) return;
  try {
    await fetch("/api/finished/" + id, { method: "DELETE" });
    books = books.filter(b => b.id !== id);
    render();
  } catch (e) {
    console.error(e);
  }
}

async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  isLoggedIn = false;
  loggedInUsername = null;
  isOwnProfile = false;
  render();
}

// Expose functions to global scope
declare global {
  interface Window {
    addBook: typeof addBook;
    deleteBook: typeof deleteBook;
    doLogout: typeof doLogout;
  }
}

window.addBook = addBook;
window.deleteBook = deleteBook;
window.doLogout = doLogout;

loadBooks();
