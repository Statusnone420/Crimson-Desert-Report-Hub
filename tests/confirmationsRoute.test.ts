import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));

const state = {
  rateCount: 0,
  clusterFound: true,
  upsertError: null as { message: string } | null,
};

const confirmationUpsert = vi.fn(async (row: Record<string, unknown>, options: Record<string, unknown>) => {
  void row;
  void options;
  return { error: state.upsertError };
});

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "issue_confirmations") {
        return {
          upsert: confirmationUpsert,
          select: () => ({ eq: () => ({ gte: async () => ({ count: state.rateCount, error: null }) }) }),
        };
      }
      if (table === "issue_clusters") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({ data: state.clusterFound ? [{ id: "cluster-1" }] : [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
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
  options: { ip?: string | null; origin?: string; fetchSite?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.ip !== null) headers["x-forwarded-for"] = options.ip ?? "203.0.113.7";
  if (options.origin) headers.origin = options.origin;
  if (options.fetchSite) headers["sec-fetch-site"] = options.fetchSite;
  return new Request("http://localhost/api/confirmations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  cacheMocks.revalidateTag.mockClear();
  confirmationUpsert.mockClear();
  state.rateCount = 0;
  state.clusterFound = true;
  state.upsertError = null;
});

describe("POST /api/confirmations", () => {
  it("403 in Vercel preview without persisting", async () => {
    process.env.VERCEL_ENV = "preview";
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(403);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("403 on cross-site requests", async () => {
    const byOrigin = await POST(makeRequest(valid, { origin: "https://evil.example" }));
    expect(byOrigin.status).toBe(403);
    const byFetchSite = await POST(makeRequest(valid, { fetchSite: "cross-site" }));
    expect(byFetchSite.status).toBe(403);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("400 on invalid json, bad kind, bad platform, or non-uuid cluster", async () => {
    const badJson = new Request("http://localhost/api/confirmations", { method: "POST", body: "{nope" });
    expect((await POST(badJson)).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, kind: "love_it" }))).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, platform: "n64" }))).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, cluster_id: "not-a-uuid" }))).status).toBe(400);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("400 when no client ip — one voice needs a hash", async () => {
    const res = await POST(makeRequest(valid, { ip: null }));
    expect(res.status).toBe(400);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("404 when the cluster is missing or not public", async () => {
    state.clusterFound = false;
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(404);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("429 when the network already tapped 20 times this hour", async () => {
    state.rateCount = 20;
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(429);
    expect(confirmationUpsert).not.toHaveBeenCalled();
  });

  it("201 happy path: one-voice upsert, server-derived patch, hashed voter, no raw ip", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(201);
    expect(confirmationUpsert).toHaveBeenCalledOnce();
    const [row, options] = confirmationUpsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(row.cluster_id).toBe(valid.cluster_id);
    expect(row.kind).toBe("still_happening");
    expect(row.platform).toBe("ps5");
    expect(row.patch_family).toBe("1.13");
    expect(row.patch_version).toBe("1.13.01");
    expect(row.voter_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.created_at).toBeDefined(); // stance changes must refresh the poll-window timestamp
    expect(options.onConflict).toBe("cluster_id,patch_family,voter_ip_hash");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-dashboard", "max");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-issues", "max");
  });

  it("500 when the upsert fails", async () => {
    state.upsertError = { message: "boom" };
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(500);
  });
});
