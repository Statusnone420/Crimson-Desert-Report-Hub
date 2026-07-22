import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "cd_admin";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionToken(secret: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = String(Date.now() + ttlMs);
  const sig = createHmac("sha256", secret).update(expiresAt).digest("base64url");
  return `${expiresAt}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiresAt, sig] = parts;
  if (!/^\d+$/.test(expiresAt)) return false;
  const expected = createHmac("sha256", secret).update(expiresAt).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  return Number(expiresAt) > Date.now();
}

export function passwordMatches(candidate: string, actual: string, comparisonSecret: string): boolean {
  if (!comparisonSecret) throw new Error("comparison secret required");
  // Derive transient, fixed-length comparison buffers with a password KDF.
  // The server-only session secret is a stable application salt; no verifier
  // or reusable fast password digest is stored.
  const a = scryptSync(candidate, comparisonSecret, 64);
  const b = scryptSync(actual, comparisonSecret, 64);
  return timingSafeEqual(a, b);
}
