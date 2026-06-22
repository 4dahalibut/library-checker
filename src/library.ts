const API_BASE = "https://gateway.bibliocommons.com/v2/libraries/acl";

interface BiblioSearchResponse {
  catalogSearch?: {
    results?: { representative: string }[];
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

interface DetailedAvailabilityResponse {
  error?: { message: string };
  entities?: {
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

async function getTranslatorFromISBN(isbn: string): Promise<string | undefined> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const book = data[`ISBN:${isbn}`];
    if (book?.by_statement) {
      const match = book.by_statement.match(/translat(?:ed|ion)(?: and [^;]+)? by ([^;]+)/i);
      if (match) return match[1].trim().replace(/\.$/, "");
    }
  } catch {}
  return undefined;
}

export interface Edition {
  bibId: string;
  title: string;
  subtitle?: string;
  author: string;
  isbn?: string;
  isbn13?: string;
  format: string;
  year?: string;
  series?: string;
  translator?: string;
  status: "AVAILABLE" | "UNAVAILABLE";
  availableCopies: number;
  totalCopies: number;
  heldCopies: number;
  squirrelHillAvailable: boolean;
  branches: { name: string; status: string; dueDate?: string }[];
}

export interface EditionAvailability {
  availableCopies: number;
  totalCopies: number;
  heldCopies: number;
  branches: Edition["branches"];
  squirrelHillAvailable: boolean;
}

export async function getEditionAvailability(bibId: string): Promise<EditionAvailability> {
  const url = `${API_BASE}/bibs/${bibId}/availability?locale=en-US`;
  const data = await fetchJson<DetailedAvailabilityResponse>(url);

  if (data.error || !data.entities?.availabilities || Object.keys(data.entities.availabilities).length === 0) {
    throw new Error(`Bib ${bibId} not found in catalog`);
  }

  const avail = Object.values(data.entities.availabilities)[0];
  const items = Object.values(data.entities.bibItems || {});

  const branches = items.map(item => ({
    name: item.branch?.name || "Unknown",
    status: item.availability?.libraryStatus || item.availability?.status || "Unknown",
    dueDate: item.dueDate,
  }));

  const squirrelHillAvailable = branches.some(
    b => b.name === "Squirrel Hill (CLP)" && b.status === "AVAILABLE"
  );

  return {
    availableCopies: avail?.availableCopies || 0,
    totalCopies: avail?.totalCopies || 0,
    heldCopies: avail?.heldCopies || 0,
    branches,
    squirrelHillAvailable,
  };
}

function isbnParts(isbns: string[] | undefined): { isbn?: string; isbn13?: string } {
  return {
    isbn: isbns?.find(i => i.length === 10),
    isbn13: isbns?.find(i => i.length === 13),
  };
}

type BibEntry = BiblioSearchResponse["entities"]["bibs"][string];

async function editionFromBib(bibId: string, bib: BibEntry, strictAvailability: boolean): Promise<Edition> {
  const [availabilityResult, translator] = await Promise.all([
    getEditionAvailability(bibId).then(
      avail => ({ ok: true as const, avail }),
      error => {
        if (strictAvailability) throw error;
        return {
          ok: false as const,
          avail: {
            availableCopies: bib.availability?.availableCopies || 0,
            totalCopies: bib.availability?.totalCopies || 0,
            heldCopies: bib.availability?.heldCopies || 0,
            branches: [],
            squirrelHillAvailable: false,
          },
        };
      }
    ),
    bib.briefInfo.isbns?.[0] ? getTranslatorFromISBN(bib.briefInfo.isbns[0]) : Promise.resolve(undefined),
  ]);

  const avail = availabilityResult.avail;
  const isbns = isbnParts(bib.briefInfo.isbns);

  return {
    bibId,
    title: bib.briefInfo.title,
    subtitle: bib.briefInfo.subtitle || undefined,
    author: bib.briefInfo.authors?.[0] || "",
    ...isbns,
    format: bib.briefInfo.format,
    year: bib.briefInfo.publicationDate,
    series: bib.briefInfo.series?.[0]?.name,
    translator,
    status: (avail.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE") as Edition["status"],
    availableCopies: avail.availableCopies,
    totalCopies: avail.totalCopies,
    heldCopies: avail.heldCopies,
    squirrelHillAvailable: avail.squirrelHillAvailable,
    branches: avail.branches,
  };
}

export async function getEditionById(bibId: string): Promise<Edition> {
  const url = `${API_BASE}/bibs?metadataIds=${encodeURIComponent(bibId)}&locale=en-US`;
  const data = await fetchJson<BiblioSearchResponse>(url);
  const bib = data.entities?.bibs?.[bibId];
  if (!bib) {
    throw new Error(`Bib ${bibId} not found in catalog`);
  }
  return editionFromBib(bibId, bib, true);
}

export async function searchEditions(query: string, preferredBibId?: string): Promise<Edition[]> {
  // Strip subtitle (after colon) as it can break search
  const cleanedQuery = query.split(":")[0].trim();
  const encoded = encodeURIComponent(cleanedQuery);
  const url = `${API_BASE}/bibs/search?query=${encoded}&searchType=smart&limit=20&locale=en-US`;

  const data = await fetchJson<BiblioSearchResponse>(url);
  const bibs = data.entities?.bibs || {};

  const resultIds = data.catalogSearch?.results?.map(r => r.representative).filter(Boolean) || [];
  const orderedIds = resultIds.length > 0 ? resultIds : Object.keys(bibs);
  const seen = new Set<string>();
  const bookEntries: [string, BibEntry][] = [];

  if (preferredBibId && bibs[preferredBibId]) {
    seen.add(preferredBibId);
    bookEntries.push([preferredBibId, bibs[preferredBibId]]);
  }

  for (const bibId of orderedIds) {
    if (seen.has(bibId)) continue;
    const bib = bibs[bibId];
    if (!bib) continue;
    if (bib.briefInfo.format !== "BK" || bib.briefInfo.primaryLanguage !== "eng") continue;
    seen.add(bibId);
    bookEntries.push([bibId, bib]);
    if (bookEntries.length >= 12) break;
  }

  if (preferredBibId && !seen.has(preferredBibId)) {
    try {
      bookEntries.unshift([preferredBibId, (await fetchJson<BiblioSearchResponse>(
        `${API_BASE}/bibs?metadataIds=${encodeURIComponent(preferredBibId)}&locale=en-US`
      )).entities.bibs[preferredBibId]]);
    } catch {
      // Ignore stale preferred editions; refresh/link paths surface them later.
    }
  }

  const editions = await Promise.all(
    bookEntries
      .filter(([, bib]) => !!bib)
      .map(([bibId, bib]) => editionFromBib(bibId, bib, false))
  );

  return editions;
}
