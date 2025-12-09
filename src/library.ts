import type { LibraryAvailability } from "./types.js";

const API_BASE = "https://gateway.bibliocommons.com/v2/libraries/acl";

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
          authors: string[];
          format: string;
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
  query: string
): Promise<LibraryAvailability | null> {
  const encoded = encodeURIComponent(query);
  const url = `${API_BASE}/bibs/search?query=${encoded}&searchType=smart&limit=5&locale=en-US`;

  try {
    const data = await fetchJson<BiblioSearchResponse>(url);
    const bibs = data.entities?.bibs || {};

    for (const [bibId, bib] of Object.entries(bibs)) {
      const brief = bib.briefInfo;
      const avail = bib.availability;

      // Skip non-book formats for main results (but could be useful later)
      const format = brief.format;

      // Check Squirrel Hill branch availability
      const squirrelHillAvailable = await checkSquirrelHillAvailability(bibId);

      return {
        metadataId: bibId,
        title: brief.title,
        author: brief.authors?.join(", ") || "",
        format,
        status: avail.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE",
        availableCopies: avail.availableCopies || 0,
        totalCopies: avail.totalCopies || 0,
        heldCopies: avail.heldCopies || 0,
        catalogUrl: `https://acl.bibliocommons.com/v2/record/${bibId}`,
        squirrelHillAvailable,
      };
    }
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

export async function searchByTitleAuthor(
  title: string,
  author: string
): Promise<LibraryAvailability | null> {
  return searchLibrary(`${title} ${author}`);
}
