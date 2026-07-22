import { describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/lib/session";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = createSessionToken(SECRET);
    expect(verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects undefined, malformed, and wrong-secret tokens", () => {
    expect(verifySessionToken(undefined, SECRET)).toBe(false);
    expect(verifySessionToken("garbage", SECRET)).toBe(false);
    expect(verifySessionToken("123.abc", SECRET)).toBe(false);
    const token = createSessionToken(SECRET);
    expect(verifySessionToken(token, "another-secret-another-secret!!")).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken(SECRET, -1000);
    expect(verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rejects tampered expiry", () => {
    const token = createSessionToken(SECRET);
    const [, sig] = token.split(".");
    expect(verifySessionToken(`${Date.now() + 999999999}.${sig}`, SECRET)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("uses a server-only comparison secret while preserving valid and invalid login results", () => {
    expect(passwordMatches("hunter2hunter2hunter2", "hunter2hunter2hunter2", SECRET)).toBe(true);
    expect(passwordMatches("hunter2hunter2hunter2", "wrong", SECRET)).toBe(false);
  });

  it("refuses to compare without the keyed comparison boundary", () => {
    expect(() => passwordMatches("same", "same", "")).toThrow("comparison secret required");
  });
});
