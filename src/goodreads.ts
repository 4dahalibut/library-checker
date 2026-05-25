export async function fetchNumRatings(bookId: string): Promise<number> {
  try {
    const res = await fetch(`https://www.goodreads.com/book/show/${bookId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    const html = await res.text();
    const match = html.match(/ratings">([0-9,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10);
    }
  } catch {
    // ignore
  }
  return 0;
}
