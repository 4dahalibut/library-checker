const API_BASE = "https://gateway.bibliocommons.com/v2/libraries/acl";

interface BiblioSearchResponse {
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

  const editionPromises = bookEntries.map(async ([bibId, bib]) => {
    const [avail, translator] = await Promise.all([
      getEditionAvailability(bibId),
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
      status: (avail.availableCopies > 0 ? "AVAILABLE" : "UNAVAILABLE") as Edition["status"],
      availableCopies: avail.availableCopies,
      totalCopies: avail.totalCopies,
      heldCopies: avail.heldCopies,
      branches: avail.branches,
    };
  });

  const editions = await Promise.all(editionPromises);

  editions.sort((a, b) => {
    if (a.status === "AVAILABLE" && b.status !== "AVAILABLE") return -1;
    if (b.status === "AVAILABLE" && a.status !== "AVAILABLE") return 1;
    return b.totalCopies - a.totalCopies;
  });

  return editions;
}
