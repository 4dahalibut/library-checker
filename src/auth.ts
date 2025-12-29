import { randomBytes, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { db } from "./db.js";

const PASSWORD = process.env.AUTH_PASSWORD || "12327791";
const EXPIRATION_DAYS = parseInt(process.env.SESSION_EXPIRATION_DAYS || "60");

// Initialize sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function createSession(): string {
  const sessionId = generateSessionId();
  const now = new Date();
  const expires = new Date(now.getTime() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (session_id, created_at, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, now.toISOString(), expires.toISOString());

  // Clean up expired sessions while we're here
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now.toISOString());

  return sessionId;
}

export function verifySession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;

  const session = db.prepare(`
    SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?
  `).get(sessionId, new Date().toISOString());

  return !!session;
}

export function deleteSession(sessionId: string): void {
  db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
}

export function validateCredentials(password: string): boolean {
  // Constant-time comparison for password
  const passwordBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(PASSWORD);

  if (passwordBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(passwordBuffer, expectedBuffer);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map(cookie => {
      const [name, ...rest] = cookie.trim().split("=");
      return [name, rest.join("=")];
    })
  );
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.session_id;

  if (verifySession(sessionId)) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function getSessionCookie(sessionId: string, isProduction: boolean): string {
  const maxAge = EXPIRATION_DAYS * 24 * 60 * 60;
  const secure = isProduction ? "; Secure" : "";
  return `session_id=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

export function getClearSessionCookie(): string {
  return "session_id=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}
