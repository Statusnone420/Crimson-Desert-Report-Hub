import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnstileHostnames, verifyTurnstile } from "@/lib/turnstile";

describe("verifyTurnstile", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
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
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true, hostname: "crimsonreporthub.com" }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await verifyTurnstile("tok", "203.0.113.7");
    expect(r).toEqual({ ok: true, skipped: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("fails closed on cloudflare rejection or network error", async () => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect((await verifyTurnstile("tok", null)).ok).toBe(false);
  });

  it.each([
    ["another site", { success: true, hostname: "farm.example" }],
    ["no hostname", { success: true }],
    ["a non-string hostname", { success: true, hostname: ["crimsonreporthub.com"] }],
    ["a lookalike subdomain", { success: true, hostname: "crimsonreporthub.com.farm.example" }],
  ])("refuses a token Cloudflare accepted for %s", async (_label, answer) => {
    process.env.TURNSTILE_SECRET_KEY = "sec";
    global.fetch = vi.fn().mockResolvedValue({ json: async () => answer }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", null)).toEqual({ ok: false, skipped: false });
  });

  it.each(["crimsonreporthub.com", "www.crimsonreporthub.com", "crimson-desert-report-hub.vercel.app"])(
    "accepts a token solved on %s", async (hostname) => {
      process.env.TURNSTILE_SECRET_KEY = "sec";
      process.env.VERCEL_PROJECT_PRODUCTION_URL = "crimson-desert-report-hub.vercel.app";
      global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true, hostname }) }) as unknown as typeof fetch;
      expect(await verifyTurnstile("tok", null)).toEqual({ ok: true, skipped: false });
    },
  );

  it("ignores a malformed Vercel production hostname", () => {
    expect(turnstileHostnames({ VERCEL_PROJECT_PRODUCTION_URL: "farm.example/path" } as unknown as NodeJS.ProcessEnv))
      .toEqual(new Set(["crimsonreporthub.com", "www.crimsonreporthub.com"]));
  });
});
