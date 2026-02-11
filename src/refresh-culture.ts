import Anthropic from "@anthropic-ai/sdk";
import { getAllBooksNeedingCulture, updateCulture } from "./db.js";
import "dotenv/config";

const BATCH_SIZE = 10;
const LIMIT = parseInt(process.argv[2] || "100", 10);

const CULTURES = [
  "medieval-christian",
  "sufi",
  "eastern-classical",
  "20th-century-jewish",
  "victorian-esoteric",
  "mid-century-christian",
  "psychoanalytic",
  "austrian-economics",
  "60s-consciousness",
  "80s-self-help",
  "therapy-culture",
  "silicon-valley",
  "bro-optimization",
  "tantric-embodiment",
  "literary-contemporary",
  "21st-century-conservative",
  "ccp-intellectual",
  "academic-contemporary",
  "pop-science",
  "20th-century-catholic",
];

const client = new Anthropic();

interface BookInput {
  userId: number;
  bookId: string;
  title: string;
  author: string;
  publishYear: number | null;
  genres: string | null;
}

async function classifyBatch(books: BookInput[]): Promise<{ book_id: string; culture: string }[]> {
  const bookList = books
    .map((b, i) => {
      const genres = b.genres ? JSON.parse(b.genres).slice(0, 5).join(", ") : "unknown";
      return `${i + 1}. ${b.bookId} | ${b.title} | ${b.author} | year: ${b.publishYear || "unknown"} | genres: ${genres}`;
    })
    .join("\n");

  const prompt = `Classify these books by the ERA + TRADITION the AUTHOR belongs to.
This is about the author's worldview and intellectual lineage, not the book's topic.

Key questions:
- What decade/era was the author intellectually formed?
- Who were their peers and influences?
- What assumptions did they share with their tribe?

Use the PUBLISH YEAR as a strong signal:
- Pre-1900: likely classical tradition (medieval-christian, sufi, eastern-classical)
- 1900-1950: early 20th century movements (20th-century-jewish, psychoanalytic, austrian-economics)
- 1950-1970: mid-century (mid-century-christian, early psychoanalytic)
- 1965-1985: counterculture era (60s-consciousness)
- 1980-2000: self-help boom (80s-self-help)
- 2000+: contemporary (therapy-culture, silicon-valley, bro-optimization, 21st-century-conservative)

Categories (use exactly these strings):
${CULTURES.join(", ")}

IMPORTANT: For authors you don't recognize, use web search to look up "[author name] author" to understand their background, era, and intellectual tradition before classifying.

Books to classify:
${bookList}

After researching any unknown authors, return ONLY a JSON array: [{"book_id": "123", "culture": "therapy-culture"}, ...]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    messages: [{ role: "user", content: prompt }],
  });

  // Find the text block with the JSON response
  for (const block of response.content) {
    if (block.type === "text") {
      const jsonMatch = block.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  }

  console.error("Failed to parse response:", response.content);
  return [];
}

async function main() {
  const books = getAllBooksNeedingCulture(LIMIT);
  console.log(`Classifying ${books.length} books in batches of ${BATCH_SIZE}...\n`);

  let processed = 0;

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(books.length / BATCH_SIZE)}:`);

    const results = await classifyBatch(batch);

    for (const result of results) {
      const book = batch.find((b) => b.bookId === result.book_id);
      if (book && CULTURES.includes(result.culture)) {
        updateCulture(book.userId, result.book_id, result.culture);
        console.log(`  [${result.culture}] ${book.title.substring(0, 50)}`);
        processed++;
      }
    }
  }

  console.log(`\nDone! Classified ${processed}/${books.length} books.`);
}

main().catch(console.error);
