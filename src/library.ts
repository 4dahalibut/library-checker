import Anthropic from "@anthropic-ai/sdk";
import type { LibraryAvailability } from "./types.js";

const API_BASE = "https://gateway.bibliocommons.com/v2/libraries/acl";
const anthropic = new Anthropic();

async function isMatchingBook(
  queryTitle: string,
  queryAuthor: string,
  resultTitle: string,
  resultAuthors: string[]
): Promise<boolean> {
  // Skip for ISBN-like queries
  if (/^[\d\-\s]+$/.test(queryTitle)) return true;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{
        role: "user",
        content: `Does this library catalog entry match the book I'm looking for?
Book I want: "${queryTitle}" by "${queryAuthor}"
Library result: "${resultTitle}" by "${resultAuthors.join(", ")}"
Answer YES or NO only.`
      }]
    });
    const answer = (message.content[0] as { text: string }).text.trim().toUpperCase();
    return answer.startsWith("YES");
  } catch (error) {
    console.error("Haiku match check failed, allowing match:", error);
    return true;
  }
}

interface BiblioSearchResponse {
  catalogSearch: {
    results: { representative: string }[];
  };
  entities: {
    bibs: Record<
      string,
      {
        briefInfo: {
          title: string;
          subtitle?: string;
          authors: string[];
          format: string;
          primaryLanguage: string;
          publicationDate?: string;
          series?: { name: string }[];
          isbns?: string[];
        };
        availability: {
          status: string;
          availableCopies: number;
          totalCopies: number;
          heldCopies: number;
        };
      }
    >;
  };
}

async function getTranslatorFromISBN(isbn: string): Promise<string | undefined> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const book = data[`ISBN:${isbn}`];
    if (book?.by_statement) {
      // Extract translator from by_statement like "translated by X" or "translation by X"
      // Match up to semicolon or end, allowing periods in names like "E. Allison Peers"
      const match = book.by_statement.match(/translat(?:ed|ion)(?: and [^;]+)? by ([^;]+)/i);
      if (match) return match[1].trim().replace(/\.$/, "");
    }
  } catch {}
  return undefined;
}

interface BiblioAvailabilityResponse {
  entities: {
    bibItems: Record<
      string,
      {
        branch: {
          name: string;
          code: string;
        };
        availability: {
          status: string;
        };
      }
    >;
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      origin: "https://acl.bibliocommons.com",
      referer: "https://acl.bibliocommons.com/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  return response.json() as Promise<T>;
}

async function checkSquirrelHillAvailability(bibId: string): Promise<boolean> {
  const url = `${API_BASE}/bibs/${bibId}/availability?locale=en-US`;
  try {
    const data = await fetchJson<BiblioAvailabilityResponse>(url);
    const items = data.entities?.bibItems || {};
    for (const item of Object.values(items)) {
      if (
        item.branch?.name === "Squirrel Hill (CLP)" &&
        item.availability?.status === "AVAILABLE"
      ) {
        return true;
      }
    }
  } catch (error) {
    console.error(`Error checking Squirrel Hill availability for ${bibId}:`, error);
  }
  return false;
}

export async function searchLibrary(
  query: string,
  queryMeta?: { title: string; author: string }
): Promise<LibraryAvailability | null> {
  const encoded = encodeURIComponent(query);
  const url = `${API_BASE}/bibs/search?query=${encoded}&searchType=smart&limit=20&locale=en-US`;

  try {
    const data = await fetchJson<BiblioSearchResponse>(url);
    const bibs = data.entities?.bibs || {};
    const entries = Object.entries(bibs);

    // Filter to English physical books and sort by total copies (prefer editions with more copies)
    const bookEntries = entries
      .filter(([, bib]) => bib.briefInfo.format === "BK" && bib.briefInfo.primaryLanguage === "eng")
      .sort((a, b) => (b[1].availability?.totalCopies || 0) - (a[1].availability?.totalCopies || 0));

    // Fall back to any English result if no physical books
    const englishEntries = entries.filter(([, bib]) => bib.briefInfo.primaryLanguage === "eng");

    type BibPair = (typeof entries)[0];
    let matched: BibPair | undefined;

    if (queryMeta) {
      // Vet bookEntries in parallel with Haiku
      if (bookEntries.length > 0) {
        const checks = await Promise.all(
          bookEntries.map(async (pair) => {
            const [, b] = pair;
            const ok = await isMatchingBook(queryMeta.title, queryMeta.author, b.briefInfo.title, b.briefInfo.authors || []);
            return ok ? pair : null;
          })
        );
        matched = checks.find(r => r !== null) ?? undefined;
      }

      // If no match, try non-BK English entries
      if (!matched) {
        const bookBibIds = new Set(bookEntries.map(([id]) => id));
        const nonBookEnglish = englishEntries.filter(([id]) => !bookBibIds.has(id));
        if (nonBookEnglish.length > 0) {
          const checks = await Promise.all(
            nonBookEnglish.map(async (pair) => {
              const [, b] = pair;
              const ok = await isMatchingBook(queryMeta.title, queryMeta.author, b.briefInfo.title, b.briefInfo.authors || []);
              return ok ? pair : null;
            })
          );
          matched = checks.find(r => r !== null) ?? undefined;
        }
      }
    } else {
      matched = bookEntries[0] || englishEntries[0];
    }

    const [bibId, bib] = matched || [];

    if (!bibId || !bib) return null;

    const brief = bib.briefInfo;
    const avail = bib.availability;

    // Check Squirrel Hill branch availability
    const squirrelHillAvailable = await checkSquirrelHillAvailability(bibId);

    return {
      metadataId: bibId,
      title: brief.title,
      author: brief.authors?.join(", ") || "",
      format: brief.format,
      status: avail.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE",
      availableCopies: avail.availableCopies || 0,
      totalCopies: avail.totalCopies || 0,
      heldCopies: avail.heldCopies || 0,
      catalogUrl: `https://acl.bibliocommons.com/v2/record/${bibId}`,
      squirrelHillAvailable,
    };
  } catch (error) {
    console.error(`Error searching for "${query}":`, error);
  }

  return null;
}

export async function searchByISBN(
  isbn: string
): Promise<LibraryAvailability | null> {
  if (!isbn) return null;
  return searchLibrary(isbn);
}

export interface Edition {
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

interface DetailedAvailabilityResponse {
  entities: {
    availabilities: Record<string, {
      heldCopies: number;
      availableCopies: number;
      totalCopies: number;
    }>;
    bibItems: Record<string, {
      branch: { name: string; code: string };
      dueDate?: string;
      availability: { status: string; libraryStatus: string };
    }>;
  };
}

async function getEditionDetails(bibId: string): Promise<{ branches: Edition["branches"]; heldCopies: number }> {
  const url = `${API_BASE}/bibs/${bibId}/availability?locale=en-US`;
  const data = await fetchJson<DetailedAvailabilityResponse>(url);

  const avail = Object.values(data.entities?.availabilities || {})[0];
  const items = Object.values(data.entities?.bibItems || {});

  const branches = items.map(item => ({
    name: item.branch?.name || "Unknown",
    status: item.availability?.libraryStatus || item.availability?.status || "Unknown",
    dueDate: item.dueDate,
  }));

  return { branches, heldCopies: avail?.heldCopies || 0 };
}

export async function searchEditions(query: string): Promise<Edition[]> {
  // Strip subtitle (after colon) as it can break search
  const cleanedQuery = query.split(":")[0].trim();
  const encoded = encodeURIComponent(cleanedQuery);
  const url = `${API_BASE}/bibs/search?query=${encoded}&searchType=smart&limit=20&locale=en-US`;

  const data = await fetchJson<BiblioSearchResponse>(url);
  const bibs = data.entities?.bibs || {};

  // Filter to English physical books, limit to 10
  const bookEntries = Object.entries(bibs)
    .filter(([, bib]) => bib.briefInfo.format === "BK" && bib.briefInfo.primaryLanguage === "eng")
    .slice(0, 10);

  // Fetch all details in parallel
  const editionPromises = bookEntries.map(async ([bibId, bib]) => {
    const [details, translator] = await Promise.all([
      getEditionDetails(bibId),
      bib.briefInfo.isbns?.[0] ? getTranslatorFromISBN(bib.briefInfo.isbns[0]) : Promise.resolve(undefined),
    ]);

    return {
      bibId,
      title: bib.briefInfo.title,
      subtitle: bib.briefInfo.subtitle || undefined,
      author: bib.briefInfo.authors?.[0] || "",
      format: bib.briefInfo.format,
      year: bib.briefInfo.publicationDate,
      series: bib.briefInfo.series?.[0]?.name,
      translator,
      status: (bib.availability.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE") as Edition["status"],
      availableCopies: bib.availability.availableCopies,
      totalCopies: bib.availability.totalCopies,
      heldCopies: details.heldCopies,
      branches: details.branches,
    };
  });

  const editions = await Promise.all(editionPromises);

  // Sort: available first, then by total copies
  editions.sort((a, b) => {
    if (a.status === "AVAILABLE" && b.status !== "AVAILABLE") return -1;
    if (b.status === "AVAILABLE" && a.status !== "AVAILABLE") return 1;
    return b.totalCopies - a.totalCopies;
  });

  return editions;
}

export async function searchByTitleAuthor(
  title: string,
  author: string
): Promise<LibraryAvailability | null> {
  // Strip subtitle (after colon) as it can break search
  const mainTitle = title.split(":")[0].trim();
  return searchLibrary(`${mainTitle} ${author}`, { title: mainTitle, author });
}

export async function getEditionById(bibId: string): Promise<Edition | null> {
  try {
    const [bibData, details] = await Promise.all([
      fetchJson<BiblioSearchResponse>(`${API_BASE}/bibs/${bibId}?locale=en-US`),
      getEditionDetails(bibId),
    ]);

    const bib = bibData.entities?.bibs?.[bibId];
    if (!bib) return null;

    const brief = bib.briefInfo;
    const avail = bib.availability;
    const translator = brief.isbns?.[0] ? await getTranslatorFromISBN(brief.isbns[0]) : undefined;

    return {
      bibId,
      title: brief.title,
      subtitle: brief.subtitle || undefined,
      author: brief.authors?.[0] || "",
      format: brief.format,
      year: brief.publicationDate,
      series: brief.series?.[0]?.name,
      translator,
      status: (avail.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE") as Edition["status"],
      availableCopies: avail.availableCopies,
      totalCopies: avail.totalCopies,
      heldCopies: details.heldCopies,
      branches: details.branches,
    };
  } catch (error) {
    console.error(`Error fetching edition ${bibId}:`, error);
    return null;
  }
}
