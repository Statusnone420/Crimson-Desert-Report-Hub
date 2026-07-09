import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));

const state = {
  rpcOutcome: "recorded",
  rpcError: null as { message: string } | null,
};

const confirmationRpc = vi.fn(async () => ({ data: state.rpcOutcome, error: state.rpcError }));

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    rpc: confirmationRpc,
  }),
}));

vi.mock("next/cache", () => ({ revalidateTag: cacheMocks.revalidateTag }));

vi.mock("@/lib/officialPatch.server", () => ({
  getCurrentPatchMetadata: vi.fn(async () => ({
    version: "1.13.01",
    title: "Patch Notes 1.13.01",
    officialUrl: "https://example.com/notes",
    summary: null,
    publishedAt: "2026-07-08T00:00:00Z",
  })),
}));

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

import { POST } from "@/app/api/confirmations/route";

const valid = {
  cluster_id: "3f2f5a1e-0000-4000-8000-000000000001",
  platform: "ps5",
  kind: "still_happening",
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
  return new Request("http://localhost/api/confirmations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  cacheMocks.revalidateTag.mockClear();
  confirmationRpc.mockClear();
  state.rpcOutcome = "recorded";
  state.rpcError = null;
});

describe("POST /api/confirmations", () => {
  it("403 in Vercel preview without persisting", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(403);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("403 on cross-site requests", async () => {
    const byOrigin = await POST(makeRequest(valid, { origin: "https://evil.example" }));
    expect(byOrigin.status).toBe(403);
    const byFetchSite = await POST(makeRequest(valid, { fetchSite: "cross-site" }));
    expect(byFetchSite.status).toBe(403);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("403 when neither browser fetch metadata nor a matching origin is present", async () => {
    const res = await POST(makeRequest(valid, { fetchSite: null }));
    expect(res.status).toBe(403);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("415 unless the request content type is JSON", async () => {
    expect((await POST(makeRequest(valid, { contentType: "text/plain" }))).status).toBe(415);
    expect((await POST(makeRequest(valid, { contentType: null }))).status).toBe(415);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("400 on invalid json, bad kind, bad platform, or non-uuid cluster", async () => {
    const badJson = new Request("http://localhost/api/confirmations", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "{nope",
    });
    expect((await POST(badJson)).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, kind: "love_it" }))).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, platform: "n64" }))).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, cluster_id: "not-a-uuid" }))).status).toBe(400);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("400 when no client ip — one voice needs a hash", async () => {
    const res = await POST(makeRequest(valid, { ip: null }));
    expect(res.status).toBe(400);
    expect(confirmationRpc).not.toHaveBeenCalled();
  });

  it("404 when the cluster is missing or not public", async () => {
    state.rpcOutcome = "unknown_issue";
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(404);
    expect(confirmationRpc).toHaveBeenCalledOnce();
  });

  it("429 when the atomic writer rejects the network's 21st write this hour", async () => {
    state.rpcOutcome = "rate_limited";
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(429);
    expect(confirmationRpc).toHaveBeenCalledOnce();
  });

  it("201 happy path: atomic one-voice write, server-derived patch, hashed voter, no raw ip", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(201);
    expect(confirmationRpc).toHaveBeenCalledOnce();
    const [name, args] = confirmationRpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("record_issue_confirmation");
    expect(args.p_cluster_id).toBe(valid.cluster_id);
    expect(args.p_kind).toBe("still_happening");
    expect(args.p_platform).toBe("ps5");
    expect(args.p_patch_family).toBe("1.13");
    expect(args.p_patch_version).toBe("1.13.01");
    expect(args.p_voter_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.7");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-dashboard", "max");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-issues", "max");
  });

  it("500 when the atomic writer fails", async () => {
    state.rpcError = { message: "boom" };
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(500);
  });
});
