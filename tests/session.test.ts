import { describe, expect, it } from "vitest";
import {
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
  adminCookieOptions,
  createSessionToken,
  passwordMatches,
  readSessionToken,
  sessionNeedsRenewal,
  verifySessionToken,
} from "@/lib/session";

const SECRET = "0123456789abcdef0123456789abcdef";
const DAY = 24 * 60 * 60 * 1000;

describe("session tokens", () => {
  it("round-trips a valid token with its generation and 30-day lifetime", () => {
    const now = Date.now();
    const token = createSessionToken(SECRET, 3, now);
    expect(readSessionToken(token, SECRET, now)).toEqual({ generation: 3, issuedAt: now, expiresAt: now + 30 * DAY });
    expect(verifySessionToken(token, SECRET, 3)).toBe(true);
    expect(SESSION_TTL_MS).toBe(30 * DAY);
    expect(adminCookieOptions()).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
  });

  it("rejects a session from an earlier or later generation", () => {
    const token = createSessionToken(SECRET, 3);
    expect(verifySessionToken(token, SECRET, 4)).toBe(false);
    expect(verifySessionToken(token, SECRET, 2)).toBe(false);
  });

  it("refuses to issue a session without a valid generation", () => {
    for (const generation of [0, -1, 1.5, Number.NaN]) {
      expect(() => createSessionToken(SECRET, generation)).toThrow("invalid session generation");
    }
  });

  it("rejects undefined, malformed, old-format, and wrong-secret tokens", () => {
    expect(readSessionToken(undefined, SECRET)).toBeNull();
    expect(readSessionToken("garbage", SECRET)).toBeNull();
    expect(readSessionToken("123.abc", SECRET)).toBeNull();
    // The 12-hour format had only an expiry; it no longer counts, so everyone signs in once.
    const [, , expiresAt, sig] = createSessionToken(SECRET, 1).split(".");
    expect(readSessionToken(`${expiresAt}.${sig}`, SECRET)).toBeNull();
    expect(readSessionToken(createSessionToken(SECRET, 1), "another-secret-another-secret!!")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = Date.now();
    const token = createSessionToken(SECRET, 1, now - 31 * DAY);
    expect(readSessionToken(token, SECRET, now)).toBeNull();
    expect(readSessionToken(createSessionToken(SECRET, 1, now, -1000), SECRET, now)).toBeNull();
  });

  it("rejects a tampered generation, issue time, or expiry", () => {
    const token = createSessionToken(SECRET, 1);
    const [generation, issuedAt, expiresAt, sig] = token.split(".");
    expect(readSessionToken([2, issuedAt, expiresAt, sig].join("."), SECRET)).toBeNull();
    expect(readSessionToken([generation, Number(issuedAt) + DAY, expiresAt, sig].join("."), SECRET)).toBeNull();
    expect(readSessionToken([generation, issuedAt, Number(expiresAt) + 365 * DAY, sig].join("."), SECRET)).toBeNull();
  });

  it("renews a session once it is a day old", () => {
    const now = Date.now();
    const fresh = readSessionToken(createSessionToken(SECRET, 1, now - SESSION_RENEW_AFTER_MS + 1000), SECRET, now)!;
    const dayOld = readSessionToken(createSessionToken(SECRET, 1, now - SESSION_RENEW_AFTER_MS), SECRET, now)!;
    expect(sessionNeedsRenewal(fresh, now)).toBe(false);
    expect(sessionNeedsRenewal(dayOld, now)).toBe(true);
  });
});

describe("passwordMatches", () => {
  it("uses a server-only comparison secret while preserving valid and invalid login results", async () => {
    await expect(passwordMatches("hunter2hunter2hunter2", "hunter2hunter2hunter2", SECRET)).resolves.toBe(true);
    await expect(passwordMatches("hunter2hunter2hunter2", "wrong", SECRET)).resolves.toBe(false);
  });

  it("refuses to compare without the keyed comparison boundary", async () => {
    await expect(passwordMatches("same", "same", "")).rejects.toThrow("comparison secret required");
  });
});
