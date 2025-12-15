import Database from "better-sqlite3";

const db = new Database("data/library.db");

async function getBio(author: string): Promise<string> {
  const name = author.split(",")[0].trim().replace(/ /g, "_");
  try {
    const res = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(name)
    );
    const data = await res.json();
    return data.extract?.substring(0, 400) || "";
  } catch {
    return "";
  }
}

async function main() {
  const books = db
    .prepare("SELECT book_id, title, author FROM books WHERE culture IS NOT NULL LIMIT 50")
    .all() as { book_id: string; title: string; author: string }[];

  for (const b of books) {
    const bio = await getBio(b.author);
    console.log(`${b.author}:`);
    console.log(`  ${bio || "No bio found"}`);
    console.log(`  Book: ${b.title}`);
    console.log("---");
  }
}

main();
