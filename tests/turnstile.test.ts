import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

describe("verifyTurnstile", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("skips (ok) when no secret is configured", async () => {
    const r = await verifyTurnstile("anything", null);
    expect(r).toEqual({ ok: true, skipped: true });
  });

  it("fails when secret exists but no token supplied", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    const r = await verifyTurnstile(undefined, null);
    expect(r).toEqual({ ok: false, skipped: false });
  });

  it("passes through cloudflare success", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }) as unknown as typeof fetch;
    const r = await verifyTurnstile("tok", "203.0.113.7");
    expect(r).toEqual({ ok: true, skipped: false });
  });

  it("fails closed on cloudflare rejection or network error", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
  });
});
