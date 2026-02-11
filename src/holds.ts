import { config } from "dotenv";
config();

const BASE_URL = "https://acl.bibliocommons.com";
const GATEWAY_URL = "https://gateway.bibliocommons.com/v2/libraries/acl";

export interface LibraryCredentials {
  barcode: string;
  pin: string;
  accountId: string;
}

export interface Hold {
  title: string;
  author: string;
  format: string;
  year: string;
  status: "in_transit" | "not_yet_available" | "ready" | "unknown";
  statusText: string;
  bibId: string;
  holdId: string;
  queuePosition?: number;
  totalHolds?: number;
  dueDate?: string;
  pickupBy?: string;
}

async function getLoginPage(): Promise<{ token: string; cookies: string }> {
  const response = await fetch(`${BASE_URL}/user/login?destination=%2Fv2%2Fholds`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  const html = await response.text();
  const tokenMatch = html.match(/authenticity_token.*?value="([^"]+)"/);
  const token = tokenMatch?.[1] || "";

  const cookies = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");

  return { token, cookies };
}

interface LoginResult {
  cookies: string;
  accessToken: string;
  sessionId: string;
}

async function login(token: string, cookies: string, barcode: string, pin: string): Promise<LoginResult> {
  const body = new URLSearchParams({
    utf8: "✓",
    authenticity_token: token,
    name: barcode,
    user_pin: pin,
  });

  const response = await fetch(`${BASE_URL}/user/login?destination=%2Fv2%2Fholds`, {
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "content-type": "application/x-www-form-urlencoded",
      "cookie": cookies,
      "referer": `${BASE_URL}/user/login`,
    },
    body: body.toString(),
    redirect: "manual",
  });

  const setCookies = response.headers.getSetCookie();
  const newCookies = setCookies.map(c => c.split(";")[0]).join("; ");
  const allCookies = cookies + "; " + newCookies;

  // Extract access token and session ID from cookies
  let accessToken = "";
  let sessionId = "";
  for (const cookie of setCookies) {
    if (cookie.startsWith("bc_access_token=")) {
      accessToken = cookie.split("=")[1].split(";")[0];
    }
    if (cookie.startsWith("session_id=")) {
      sessionId = cookie.split("=")[1].split(";")[0];
    }
  }

  return { cookies: allCookies, accessToken, sessionId };
}

async function fetchHoldsPage(cookies: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/v2/holds`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "cookie": cookies,
    },
  });

  return response.text();
}

export async function discoverAccountId(barcode: string, pin: string): Promise<string | null> {
  try {
    const { token, cookies } = await getLoginPage();
    const session = await login(token, cookies, barcode, pin);
    const html = await fetchHoldsPage(session.cookies);

    // If we got redirected back to login, credentials are invalid
    if (html.includes('id="user_pin"') || html.includes('Sign In')) {
      return null;
    }

    const jsonMatch = html.match(/<script[^>]*type="application\/json"[^>]*data-iso-key="_0"[^>]*>([\s\S]*?)<\/script>/);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[1]);
    const accounts = data?.entities?.accounts;
    if (!accounts) return null;

    const accountId = Object.keys(accounts)[0];
    return accountId || null;
  } catch {
    return null;
  }
}

interface HoldsPageData {
  entities: {
    holds: Record<string, {
      holdsId: string;
      metadataId: string;
      status: string;
      bibTitle: string;
      holdsPosition: number;
      holdText: string;
      pickupByDate?: string;
    }>;
    bibs: Record<string, {
      briefInfo: {
        title: string;
        authors: string[];
        format: string;
        publicationDate: string;
      };
    }>;
  };
}

interface AvailabilityData {
  entities: {
    availabilities: Record<string, {
      heldCopies: number;
      totalCopies: number;
    }>;
    bibItems: Record<string, {
      dueDate?: string;
      availability: {
        libraryStatus: string;
      };
    }>;
  };
}

async function fetchAvailability(bibId: string): Promise<AvailabilityData | null> {
  const response = await fetch(`${GATEWAY_URL}/bibs/${bibId}/availability?locale=en-US`);
  if (!response.ok) return null;
  return response.json();
}

async function parseHolds(html: string): Promise<Hold[]> {
  // Extract the JSON data from <script type="application/json" data-iso-key="_0">
  const jsonMatch = html.match(/<script[^>]*type="application\/json"[^>]*data-iso-key="_0"[^>]*>([\s\S]*?)<\/script>/);
  if (!jsonMatch) return [];

  let data: HoldsPageData;
  try {
    data = JSON.parse(jsonMatch[1]);
  } catch {
    return [];
  }

  const holdsData = data.entities?.holds || {};
  const bibsData = data.entities?.bibs || {};
  const holdEntries = Object.entries(holdsData);

  // Fetch all availability data in parallel for not-yet-available holds
  const availabilityMap = new Map<string, AvailabilityData | null>();
  const notYetAvailableIds = holdEntries
    .filter(([, h]) => h.status.toLowerCase() === "not_yet_available")
    .map(([, h]) => h.metadataId);

  if (notYetAvailableIds.length > 0) {
    const results = await Promise.all(notYetAvailableIds.map(id => fetchAvailability(id)));
    notYetAvailableIds.forEach((id, i) => availabilityMap.set(id, results[i]));
  }

  // Build holds array
  const holds: Hold[] = [];
  for (const [, hold] of holdEntries) {
    const bib = bibsData[hold.metadataId];
    const briefInfo = bib?.briefInfo;

    const status = hold.status.toLowerCase().replace(/_/g, '_');
    let normalizedStatus: Hold["status"] = "unknown";
    if (status === "in_transit") normalizedStatus = "in_transit";
    else if (status === "not_yet_available") normalizedStatus = "not_yet_available";
    else if (status === "ready" || status === "available" || status === "ready_for_pickup") normalizedStatus = "ready";

    let statusText = {
      in_transit: "In Transit",
      not_yet_available: "Not Ready",
      ready: "Ready for Pickup",
      unknown: status,
    }[normalizedStatus];

    let queuePosition: number | undefined;
    let totalHolds: number | undefined;
    let dueDate: string | undefined;
    let pickupBy: string | undefined;

    if (hold.pickupByDate) {
      pickupBy = hold.pickupByDate;
    }

    // Use pre-fetched availability data
    if (normalizedStatus === "not_yet_available") {
      const availability = availabilityMap.get(hold.metadataId);
      if (availability) {
        const avail = Object.values(availability.entities.availabilities)[0];
        const item = Object.values(availability.entities.bibItems)[0];

        totalHolds = avail?.heldCopies;
        dueDate = item?.dueDate;

        const parts: string[] = [];
        if (totalHolds && totalHolds > 1) {
          parts.push(`${totalHolds} holds`);
        }
        if (avail?.totalCopies) {
          parts.push(`${avail.totalCopies} ${avail.totalCopies === 1 ? "copy" : "copies"}`);
        }
        if (dueDate) {
          const due = new Date(dueDate);
          parts.push(`due ${due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
        }
        if (parts.length > 0) {
          statusText = parts.join(", ");
        }
      }
    }

    holds.push({
      title: briefInfo?.title || hold.bibTitle || "Unknown",
      author: briefInfo?.authors?.[0] || "",
      format: briefInfo?.format || "Book",
      year: briefInfo?.publicationDate || "",
      status: normalizedStatus,
      statusText,
      bibId: hold.metadataId,
      holdId: hold.holdsId,
      queuePosition,
      totalHolds,
      dueDate,
      pickupBy,
    });
  }

  return holds;
}

// Cache sessions per user for 30 minutes
const sessionCache = new Map<string, { session: LoginResult; expiry: number }>();

async function getSession(creds: LibraryCredentials, forceRefresh = false): Promise<LoginResult> {
  const key = creds.barcode;
  const cached = sessionCache.get(key);
  if (!forceRefresh && cached && Date.now() < cached.expiry) {
    return cached.session;
  }
  const { token, cookies } = await getLoginPage();
  const session = await login(token, cookies, creds.barcode, creds.pin);
  sessionCache.set(key, { session, expiry: Date.now() + 30 * 60 * 1000 });
  return session;
}

function clearSession(creds: LibraryCredentials) {
  sessionCache.delete(creds.barcode);
}

export async function getHolds(creds: LibraryCredentials): Promise<Hold[]> {
  const session = await getSession(creds);
  const html = await fetchHoldsPage(session.cookies);

  // If session expired, page will have login form - retry with fresh session
  if (html.includes('id="user_pin"') || html.includes('Sign In')) {
    clearSession(creds);
    const freshSession = await getSession(creds, true);
    const freshHtml = await fetchHoldsPage(freshSession.cookies);
    return parseHolds(freshHtml);
  }

  return parseHolds(html);
}

async function doPlaceHold(bibId: string, branchId: string, accountId: string, session: LoginResult): Promise<Response> {
  return fetch(`${GATEWAY_URL}/holds?locale=en-US`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "cookie": session.cookies,
      "origin": BASE_URL,
      "referer": `${BASE_URL}/`,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "x-access-token": session.accessToken,
      "x-session-id": session.sessionId,
    },
    body: JSON.stringify({
      metadataId: bibId,
      materialType: "PHYSICAL",
      accountId: parseInt(accountId),
      enableSingleClickHolds: false,
      materialParams: {
        branchId,
        expiryDate: null,
        errorMessageLocale: "en-US",
      },
    }),
  });
}

export async function placeHold(bibId: string, creds: LibraryCredentials, branchId = "YQ"): Promise<{ success: boolean; message: string }> {
  let session = await getSession(creds);
  let response = await doPlaceHold(bibId, branchId, creds.accountId, session);

  // Retry with fresh session on auth error
  if (response.status === 401 || response.status === 403) {
    clearSession(creds);
    session = await getSession(creds, true);
    response = await doPlaceHold(bibId, branchId, creds.accountId, session);
  }

  const data = await response.json();

  if (response.ok) {
    return { success: true, message: "Hold placed successfully" };
  } else {
    console.error("Hold API error response:", JSON.stringify(data, null, 2));
    const errorMsg = data?.errors?.[0]?.message || data?.errors?.[0]?.detail || data?.message || data?.error?.message || `Hold failed (${response.status})`;
    return { success: false, message: errorMsg };
  }
}

async function doCancelHold(holdId: string, metadataId: string, accountId: string, session: LoginResult): Promise<Response> {
  return fetch(`${GATEWAY_URL}/holds?locale=en-US`, {
    method: "DELETE",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "cookie": session.cookies,
      "origin": BASE_URL,
      "referer": `${BASE_URL}/`,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "x-access-token": session.accessToken,
      "x-session-id": session.sessionId,
    },
    body: JSON.stringify({
      accountId: parseInt(accountId),
      holdIds: [holdId],
      metadataIds: [metadataId],
    }),
  });
}

export async function cancelHold(holdId: string, metadataId: string, creds: LibraryCredentials): Promise<{ success: boolean; message: string }> {
  let session = await getSession(creds);
  let response = await doCancelHold(holdId, metadataId, creds.accountId, session);

  // Retry with fresh session on auth error
  if (response.status === 401 || response.status === 403) {
    clearSession(creds);
    session = await getSession(creds, true);
    response = await doCancelHold(holdId, metadataId, creds.accountId, session);
  }

  if (response.ok) {
    return { success: true, message: "Hold cancelled successfully" };
  } else {
    const data = await response.json();
    const errorMsg = data?.errors?.[0]?.message || data?.message || "Failed to cancel hold";
    return { success: false, message: errorMsg };
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const creds: LibraryCredentials = {
      barcode: process.env.LIBRARY_BARCODE!,
      pin: process.env.LIBRARY_PIN!,
      accountId: process.env.LIBRARY_ACCOUNT_ID!,
    };
    console.log("Fetching holds...\n");
    const holds = await getHolds(creds);

    if (holds.length === 0) {
      console.log("No holds found.");
    } else {
      console.log(`Found ${holds.length} holds:\n`);
      for (const hold of holds) {
        const statusIcon = hold.status === "in_transit" ? "🚚" : hold.status === "ready" ? "✅" : "⏳";
        console.log(`${statusIcon} ${hold.title}`);
        console.log(`   by ${hold.author}`);
        console.log(`   ${hold.format} ${hold.year} - ${hold.statusText}`);
        console.log();
      }
    }
  })().catch(console.error);
}
