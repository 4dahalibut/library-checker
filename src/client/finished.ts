interface FinishedBook {
  id: number;
  title: string;
  author: string | null;
  rating: number | null;
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
      <input type="text" id="add-title" class="add-input" placeholder="Book title" style="margin-bottom:5px;">
      <input type="text" id="add-author" class="add-input" placeholder="Author" style="margin-bottom:5px;">
      <select id="add-rating" class="add-input" style="margin-bottom:5px;">
        <option value="">Rating (optional)</option>
        <option value="5">5 - Amazing</option>
        <option value="4">4 - Great</option>
        <option value="3">3 - Good</option>
        <option value="2">2 - Meh</option>
        <option value="1">1 - Bad</option>
      </select>
      <textarea id="add-review" class="add-input" placeholder="Review (optional)" rows="3" style="margin-bottom:5px;"></textarea>
      <input type="submit" value="Add">
      <div id="add-status" style="font-size:12px; margin-top:5px;"></div>
    </form>
    <hr>
    ` : ""}

    ${books.length === 0 ? `
    <center><i>No finished books yet.</i></center>
    ` : `
    <div class="table-scroll">
    <table class="data-table">
      <tr bgcolor="#cccccc">
        <th align="left">Title</th>
        <th align="left">Author</th>
        <th align="center">Rating</th>
        <th align="left">Review</th>
        <th align="center">Finished</th>
        ${isLoggedIn ? '<th align="center">Actions</th>' : ''}
      </tr>
      ${books.map(renderBook).join("")}
    </table>
    </div>
    `}
  `;
}

function renderBook(book: FinishedBook): string {
  const stars = book.rating ? "★".repeat(book.rating) + "☆".repeat(5 - book.rating) : "-";
  const date = new Date(book.finishedAt).toLocaleDateString();

  return `
    <tr>
      <td>${escapeHtml(book.title)}</td>
      <td><font size="2">${escapeHtml(book.author || "")}</font></td>
      <td align="center"><font color="#cc9900">${stars}</font></td>
      <td><font size="2">${escapeHtml(book.review || "")}</font></td>
      <td align="center"><font size="2">${date}</font></td>
      ${isLoggedIn ? `
      <td align="center">
        <input type="button" class="action-btn" value="X" onclick="deleteBook(${book.id})" title="Delete">
      </td>
      ` : ''}
    </tr>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function addBook() {
  const titleInput = document.getElementById("add-title") as HTMLInputElement;
  const authorInput = document.getElementById("add-author") as HTMLInputElement;
  const ratingSelect = document.getElementById("add-rating") as HTMLSelectElement;
  const reviewInput = document.getElementById("add-review") as HTMLTextAreaElement;
  const status = document.getElementById("add-status")!;

  const title = titleInput.value.trim();
  const author = authorInput.value.trim();
  const rating = ratingSelect.value ? parseInt(ratingSelect.value) : null;
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
      body: JSON.stringify({ title, author: author || null, rating, review: review || null }),
    });
    const data = await res.json();
    if (data.success) {
      status.textContent = "Added!";
      titleInput.value = "";
      authorInput.value = "";
      ratingSelect.value = "";
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
