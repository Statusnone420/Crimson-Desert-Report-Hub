import { createHmac, scrypt, timingSafeEqual } from "node:crypto";

function derivePassword(password: string, secret: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, secret, 64, (error, key) => error ? reject(error) : resolve(key));
  });
}

export const ADMIN_COOKIE = "cd_admin";
/** A login lasts 30 days from when it was last issued or renewed. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session older than a day is re-issued on the next admin visit, so regular use keeps it alive. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export type AdminSession = { generation: number; issuedAt: number; expiresAt: number };

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * A session is "<generation>.<issuedAt>.<expiresAt>.<signature>". Only the
 * database's current admin login generation is accepted; "Sign out everywhere"
 * moves to the next one, which ends every older session at once.
 */
export function createSessionToken(secret: string, generation: number, now: number = Date.now(), ttlMs: number = SESSION_TTL_MS): string {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("invalid session generation");
  const payload = `${generation}.${now}.${now + ttlMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** The signed, unexpired session in a token, or null. The caller still checks its generation. */
export function readSessionToken(token: string | undefined, secret: string, now: number = Date.now()): AdminSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || !parts.slice(0, 3).every((part) => /^\d{1,16}$/.test(part))) return null;
  const expected = Buffer.from(sign(secret, parts.slice(0, 3).join(".")));
  const actual = Buffer.from(parts[3]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const [generation, issuedAt, expiresAt] = parts.slice(0, 3).map(Number);
  if (generation < 1 || expiresAt <= now) return null;
  return { generation, issuedAt, expiresAt };
}

export function verifySessionToken(token: string | undefined, secret: string, generation: number, now: number = Date.now()): boolean {
  return readSessionToken(token, secret, now)?.generation === generation;
}

export function sessionNeedsRenewal(session: AdminSession, now: number = Date.now()): boolean {
  return now - session.issuedAt >= SESSION_RENEW_AFTER_MS;
}

export async function passwordMatches(candidate: string, actual: string, comparisonSecret: string): Promise<boolean> {
  if (!comparisonSecret) throw new Error("comparison secret required");
  // Derive transient, fixed-length comparison buffers with a password KDF.
  // The server-only session secret is a stable application salt; no verifier
  // or reusable fast password digest is stored.
  const a = await derivePassword(candidate, comparisonSecret);
  const b = await derivePassword(actual, comparisonSecret);
  return timingSafeEqual(a, b);
}
