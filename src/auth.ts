import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { db } from "./db.js";

const EXPIRATION_DAYS = parseInt(process.env.SESSION_EXPIRATION_DAYS || "60");

// Initialize sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

// Migrate sessions table to add user_id if missing
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; username: string };
    }
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedBuffer = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, derivedBuffer);
}

export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function createSession(userId: number): string {
  const sessionId = generateSessionId();
  const now = new Date();
  const expires = new Date(now.getTime() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, userId, now.toISOString(), expires.toISOString());

  // Clean up expired sessions
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now.toISOString());

  return sessionId;
}

export function getSessionUser(sessionId: string | undefined): { userId: number; username: string } | null {
  if (!sessionId) return null;

  const row = db.prepare(`
    SELECT s.user_id as userId, u.username
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = ? AND s.expires_at > ?
  `).get(sessionId, new Date().toISOString()) as { userId: number; username: string } | undefined;

  return row || null;
}

export function deleteSession(sessionId: string): void {
  db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
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
  const user = getSessionUser(sessionId);

  if (user) {
    req.user = user;
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
