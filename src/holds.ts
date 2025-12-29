import { config } from "dotenv";
config();

const BASE_URL = "https://acl.bibliocommons.com";
const GATEWAY_URL = "https://gateway.bibliocommons.com/v2/libraries/acl";
const BARCODE = process.env.LIBRARY_BARCODE!;
const PIN = process.env.LIBRARY_PIN!;
const ACCOUNT_ID = process.env.LIBRARY_ACCOUNT_ID!;

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

interface SessionInfo {
  cookies: string;
  accessToken: string;
  sessionId: string;
  accountId: string;
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

async function login(token: string, cookies: string): Promise<LoginResult> {
  const body = new URLSearchParams({
    utf8: "✓",
    authenticity_token: token,
    name: BARCODE,
    user_pin: PIN,
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

  const holds: Hold[] = [];
  const holdsData = data.entities?.holds || {};
  const bibsData = data.entities?.bibs || {};

  for (const [holdId, hold] of Object.entries(holdsData)) {
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

    // For not-yet-available holds, fetch availability to get queue info
    if (normalizedStatus === "not_yet_available") {
      const availability = await fetchAvailability(hold.metadataId);
      if (availability) {
        const avail = Object.values(availability.entities.availabilities)[0];
        const item = Object.values(availability.entities.bibItems)[0];

        totalHolds = avail?.heldCopies;
        dueDate = item?.dueDate;

        // Build a more informative status
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

async function getSession(): Promise<LoginResult> {
  const { token, cookies } = await getLoginPage();
  return login(token, cookies);
}

export async function getHolds(): Promise<Hold[]> {
  const session = await getSession();
  const html = await fetchHoldsPage(session.cookies);
  return parseHolds(html);
}

export async function placeHold(bibId: string, branchId = "YQ"): Promise<{ success: boolean; message: string }> {
  if (!BARCODE || !PIN || !ACCOUNT_ID) {
    return { success: false, message: "Library credentials not configured" };
  }

  const session = await getSession();

  const response = await fetch(`${GATEWAY_URL}/holds?locale=en-US`, {
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
      accountId: parseInt(ACCOUNT_ID),
      enableSingleClickHolds: false,
      materialParams: {
        branchId,
        expiryDate: null,
        errorMessageLocale: "en-US",
      },
    }),
  });

  const data = await response.json();

  if (response.ok) {
    return { success: true, message: "Hold placed successfully" };
  } else {
    console.error("Hold API error response:", JSON.stringify(data, null, 2));
    const errorMsg = data?.errors?.[0]?.message || data?.errors?.[0]?.detail || data?.message || data?.error || `Hold failed (${response.status})`;
    return { success: false, message: errorMsg };
  }
}

export async function cancelHold(holdId: string, metadataId: string): Promise<{ success: boolean; message: string }> {
  const session = await getSession();

  const response = await fetch(`${GATEWAY_URL}/holds?locale=en-US`, {
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
      accountId: parseInt(ACCOUNT_ID),
      holdIds: [holdId],
      metadataIds: [metadataId],
    }),
  });

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
    console.log("Fetching holds...\n");
    const holds = await getHolds();

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
