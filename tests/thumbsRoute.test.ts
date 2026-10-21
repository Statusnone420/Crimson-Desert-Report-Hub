import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentPatchMetadata: vi.fn(),
  hasSupabaseServiceConfig: vi.fn(() => true),
  verifyTurnstile: vi.fn(async () => ({ ok: true, skipped: false })),
  revalidateTag: vi.fn(),
}));

const state = {
  rpcOutcome: "recorded" as unknown,
  rpcError: null as { message: string; code?: string } | null,
};

const thumbRpc = vi.fn(async () => ({ data: state.rpcOutcome, error: state.rpcError }));

vi.mock("@/lib/supabase", () => ({
  hasSupabaseServiceConfig: mocks.hasSupabaseServiceConfig,
  createServiceClient: () => ({ rpc: thumbRpc }),
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/officialPatch.server", () => ({ getCurrentPatchMetadata: mocks.getCurrentPatchMetadata }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import { POST } from "@/app/api/thumbs/route";

const knownPatch = {
  version: "2.03.02",
  title: "Patch Notes 2.03.02",
  officialUrl: "https://example.com/notes",
  summary: null,
  publishedAt: "2026-10-08T00:00:00Z",
  source: "official",
};

const valid = {
  cluster_id: "3f2f5a1e-0000-4000-8000-000000000001",
  patch_version: "2.03.02",
  direction: "up",
  turnstile_token: "valid-token",
};

function makeRequest(
  body: unknown,
  options: { ip?: string | null; origin?: string; fetchSite?: string | null; contentType?: string | null } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.contentType !== null) headers["content-type"] = options.contentType ?? "application/json";
  if (options.ip !== null) headers["x-forwarded-for"] = options.ip ?? "203.0.113.7";
  if (options.origin) headers.origin = options.origin;
  const fetchSite = options.fetchSite === undefined && !options.origin ? "same-origin" : options.fetchSite;
  if (fetchSite) headers["sec-fetch-site"] = fetchSite;
  return new Request("http://localhost/api/thumbs", { method: "POST", headers, body: JSON.stringify(body) });
}

function rpcArgs(call = 0) {
  return (thumbRpc.mock.calls[call] as unknown as [string, Record<string, unknown>])[1];
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  thumbRpc.mockClear();
  mocks.revalidateTag.mockClear();
  mocks.verifyTurnstile.mockReset().mockResolvedValue({ ok: true, skipped: false });
  mocks.getCurrentPatchMetadata.mockResolvedValue(knownPatch);
  mocks.hasSupabaseServiceConfig.mockReturnValue(true);
  state.rpcOutcome = "recorded";
  state.rpcError = null;
});

describe("POST /api/thumbs", () => {
  it.each(["up", "down", "none"])("saves %s with a hashed network and a token fingerprint, and answers with no count", async (direction) => {
    const res = await POST(makeRequest({ ...valid, direction }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, direction, patch_version: "2.03.02" });
    expect(thumbRpc).toHaveBeenCalledExactlyOnceWith("record_issue_thumb", {
      p_cluster_id: valid.cluster_id,
      p_patch_version: "2.03.02",
      p_direction: direction,
      p_voter_ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_token_hash: createHash("sha256").update("valid-token").digest("hex"),
    });
    expect(JSON.stringify(rpcArgs())).not.toContain("203.0.113.7");
    expect(JSON.stringify(rpcArgs())).not.toContain("valid-token");
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith("valid-token", "203.0.113.7");
    // A tap changes no public number, so it never busts the page cache.
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("gives one network the same hash, and another network a different one", async () => {
    await POST(makeRequest(valid, { ip: "2001:db8:1:2::7" }));
    await POST(makeRequest(valid, { ip: "2001:db8:1:2::9" }));
    await POST(makeRequest(valid, { ip: "198.51.100.4" }));
    expect(rpcArgs(0).p_voter_ip_hash).toBe(rpcArgs(1).p_voter_ip_hash);
    expect(rpcArgs(2).p_voter_ip_hash).not.toBe(rpcArgs(0).p_voter_ip_hash);
  });

  it("refuses writes from a Vercel preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "preview_writes_disabled" });
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it("refuses cross-site requests and requests without fetch metadata or a matching origin", async () => {
    expect((await POST(makeRequest(valid, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(makeRequest(valid, { fetchSite: "cross-site" }))).status).toBe(403);
    expect((await POST(makeRequest(valid, { fetchSite: null }))).status).toBe(403);
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it("requires a JSON body with a public issue id, the patch, a direction and a token", async () => {
    expect((await POST(makeRequest(valid, { contentType: "text/plain" }))).status).toBe(415);
    const badJson = new Request("http://localhost/api/thumbs", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "{nope",
    });
    expect((await POST(badJson)).status).toBe(400);
    for (const body of [
      { ...valid, direction: "sideways" },
      { ...valid, direction: "have_it" },
      { ...valid, cluster_id: "not-a-uuid" },
      { ...valid, patch_version: "" },
      { ...valid, turnstile_token: "" },
      { ...valid, turnstile_token: "x".repeat(2049) },
    ]) {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "validation" });
    }
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it("needs one client network before the bot check", async () => {
    for (const ip of [null, "unknown", "203.0.113.7:443"]) {
      const res = await POST(makeRequest(valid, { ip }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "no_client_ip" });
    }
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it("needs a configured and passed bot check before any write", async () => {
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: true });
    const skipped = await POST(makeRequest(valid));
    expect(skipped.status).toBe(503);
    expect(await skipped.json()).toEqual({ error: "turnstile_unavailable" });

    mocks.verifyTurnstile.mockResolvedValue({ ok: false, skipped: false });
    const failed = await POST(makeRequest(valid));
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: "captcha_failed" });
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it("refuses an unverified or different patch before any write", async () => {
    mocks.hasSupabaseServiceConfig.mockReturnValue(false);
    expect((await POST(makeRequest(valid))).status).toBe(503);
    mocks.hasSupabaseServiceConfig.mockReturnValue(true);

    mocks.getCurrentPatchMetadata.mockResolvedValue({ ...knownPatch, source: "fallback" });
    const unverified = await POST(makeRequest(valid));
    expect(unverified.status).toBe(503);
    expect(await unverified.json()).toEqual({ error: "current_patch_unavailable" });

    mocks.getCurrentPatchMetadata.mockResolvedValue(knownPatch);
    const stale = await POST(makeRequest({ ...valid, patch_version: "2.03.01" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "stale_patch" });
    expect(thumbRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["replayed", 400, "captcha_failed"],
    ["unknown_issue", 404, "unknown_issue"],
    ["stale_patch", 409, "stale_patch"],
    ["current_patch_unavailable", 503, "current_patch_unavailable"],
    ["rate_limited", 429, "rate_limited"],
    ["something_new", 500, "thumb_failed"],
    [null, 500, "thumb_failed"],
  ])("maps the writer's %s outcome without confirming a save", async (outcome, status, error) => {
    state.rpcOutcome = outcome;
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("reports thumbs as unavailable until the writer exists, and fails on other database errors", async () => {
    state.rpcError = { code: "PGRST202", message: "Could not find the function public.record_issue_thumb in the schema cache" };
    const missing = await POST(makeRequest(valid));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "thumbs_unavailable" });

    state.rpcError = { code: "42501", message: "permission denied for function record_issue_thumb" };
    const denied = await POST(makeRequest(valid));
    expect(denied.status).toBe(500);
    expect(await denied.json()).toEqual({ error: "thumb_failed" });
  });
});
