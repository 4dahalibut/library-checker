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

function parseHolds(html: string): Hold[] {
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
    else if (status === "ready" || status === "available") normalizedStatus = "ready";

    holds.push({
      title: briefInfo?.title || hold.bibTitle || "Unknown",
      author: briefInfo?.authors?.[0] || "",
      format: briefInfo?.format || "Book",
      year: briefInfo?.publicationDate || "",
      status: normalizedStatus,
      statusText: normalizedStatus === "in_transit" ? "In Transit" : normalizedStatus === "not_yet_available" ? "Not Ready" : normalizedStatus === "ready" ? "Ready for Pickup" : status,
      bibId: hold.metadataId,
      holdId: hold.holdsId,
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
    const errorMsg = data?.errors?.[0]?.message || data?.message || "Failed to place hold";
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
