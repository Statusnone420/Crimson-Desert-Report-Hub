import { describe, expect, it } from "vitest";
import { hashIp, normalizeTitle, reportFingerprint } from "@/lib/crypto";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeTitle("  FPS   DROPS!!! since 1.13  ")).toBe("fps drops since 113");
  });
});

describe("reportFingerprint", () => {
  it("is stable for equivalent titles", () => {
    const a = reportFingerprint("performance", "ps5", "FPS drops since 1.13");
    const b = reportFingerprint("performance", "ps5", "fps DROPS since 1.13!!");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs across category or platform", () => {
    const a = reportFingerprint("performance", "ps5", "fps drops");
    expect(reportFingerprint("crash_startup", "ps5", "fps drops")).not.toBe(a);
    expect(reportFingerprint("performance", "pc_steam", "fps drops")).not.toBe(a);
  });
});

describe("hashIp", () => {
  it("is deterministic per secret and never contains the raw ip", () => {
    const h = hashIp("203.0.113.7", "secret1");
    expect(h).toBe(hashIp("203.0.113.7", "secret1"));
    expect(h).not.toBe(hashIp("203.0.113.7", "secret2"));
    expect(h).not.toContain("203");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
