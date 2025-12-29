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

async function loadBooks() {
  const [booksRes, statusRes] = await Promise.all([
    fetch("/api/finished"),
    fetch("/api/status"),
  ]);
  const booksData = await booksRes.json();
  const statusData = await statusRes.json();
  books = booksData.books || [];
  isLoggedIn = statusData.authenticated || false;
  render();
}

function render() {
  document.getElementById("app")!.innerHTML = `
    ${isLoggedIn ? `
    <center>
    <input type="button" class="action-btn" value="Logout" onclick="doLogout()">
    </center>
    <hr>
    <center><b>Add finished book:</b></center>
    <form class="add-form" onsubmit="addBook(); return false;">
      <div style="display:flex; gap:10px; margin-bottom:5px;">
        <input type="text" id="add-title" class="add-input" placeholder="Book title" style="flex:2;">
        <input type="text" id="add-author" class="add-input" placeholder="Author" style="flex:1;">
      </div>
      <input type="text" id="add-vibe" class="add-input" placeholder="Vibe check (e.g. cozy, intense, thought-provoking)" style="margin-bottom:5px;">
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
        ${isLoggedIn ? `<input type="button" class="action-btn" value="X" onclick="deleteBook(${book.id})" title="Delete" style="margin-left:10px; font-size:10px; padding:2px 6px;">` : ""}
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
