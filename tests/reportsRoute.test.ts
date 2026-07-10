import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));
const automationMocks = vi.hoisted(() => ({
  refreshClusterVisibility: vi.fn(),
}));

const state = {
  insertError: null as { message: string } | null,
  insertedId: "report-1" as string | null,
  rateCount: 0,
};

const bugReportInsert = vi.fn((row: Record<string, unknown>) => {
  void row;
  return {
    select: () => ({
      single: async () => ({
        data: state.insertError || !state.insertedId ? null : { id: state.insertedId },
        error: state.insertError,
      }),
    }),
  };
});
const excerptInsert = vi.fn(async (row: { report_id: string; excerpt_text: string }) => {
  void row;
  return { error: null };
});

const clustersFixture = [
  { id: "perf", title: "FPS / performance regression since 1.13.00", category: "performance" },
];

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "bug_reports") {
        return {
          insert: bugReportInsert,
          select: () => ({ eq: () => ({ gte: async () => ({ count: state.rateCount, error: null }) }) }),
        };
      }
      if (table === "issue_clusters") {
        return { select: async () => ({ data: clustersFixture, error: null }) };
      }
      if (table === "approved_excerpts") {
        return { insert: excerptInsert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidateTag: cacheMocks.revalidateTag }));
vi.mock("@/lib/automation/run", () => ({
  refreshClusterVisibility: automationMocks.refreshClusterVisibility,
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async (token: string | undefined) =>
    token === "good" || token === undefined
      ? { ok: token === "good", skipped: false }
      : { ok: false, skipped: false },
  ),
}));

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_FREE_MODEL;

import { POST } from "@/app/api/reports/route";

const valid = {
  patch_version: "1.13.00",
  platform: "ps5",
  category: "performance",
  severity: "high",
  frequency: "often",
  issue_title: "FPS drops to 20 in Heartlands",
  description:
    "Since 1.13.00 frame rate tanks in open field combat, was smooth on 1.12. Performance mode.",
  turnstile_token: "good",
};

function makeRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  cacheMocks.revalidateTag.mockClear();
  automationMocks.refreshClusterVisibility.mockReset();
  automationMocks.refreshClusterVisibility.mockResolvedValue(undefined);
  bugReportInsert.mockClear();
  excerptInsert.mockClear();
  state.insertError = null;
  state.insertedId = "report-1";
  state.rateCount = 0;
});

describe("POST /api/reports", () => {
  it("403 in Vercel preview without persisting demo data", async () => {
    process.env.VERCEL_ENV = "preview";

    const res = await POST(makeRequest(valid));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "preview_writes_disabled" });
    expect(bugReportInsert).not.toHaveBeenCalled();
    expect(excerptInsert).not.toHaveBeenCalled();
  });

  it("201 on valid report; auto-approves, fingerprints, hashes ip, keeps raw ip out", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(201);
    expect(bugReportInsert).toHaveBeenCalledOnce();
    const row = bugReportInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.moderation_status).toBe("approved");
    expect(row.duplicate_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(row.submitter_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.turnstile_token).toBeUndefined();
    // approved reports publish a neutral (never raw) excerpt
    expect(excerptInsert).toHaveBeenCalledOnce();
    const excerpt = excerptInsert.mock.calls[0][0] as { excerpt_text: string };
    expect(excerpt.excerpt_text).toContain("player reports");
    expect(automationMocks.refreshClusterVisibility).toHaveBeenCalledWith("perf");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-dashboard", "max");
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("public-issues", "max");
  });

  it("does not invite a duplicate submission when post-insert visibility refresh fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    automationMocks.refreshClusterVisibility.mockRejectedValueOnce(new Error("refresh failed"));

    const res = await POST(makeRequest(valid));

    expect(res.status).toBe(201);
    expect(bugReportInsert).toHaveBeenCalledWith(
      expect.objectContaining({ moderation_status: "approved", cluster_id: "perf" }),
    );
    expect(automationMocks.refreshClusterVisibility).toHaveBeenCalledWith("perf");
    expect(consoleError).toHaveBeenCalledWith("cluster visibility refresh failed:", expect.any(Error));
    consoleError.mockRestore();
  });

  it("400 on invalid json and on validation failure", async () => {
    const bad = new Request("http://localhost/api/reports", { method: "POST", body: "{not json" });
    expect((await POST(bad)).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, issue_title: "x" }))).status).toBe(400);
    expect(bugReportInsert).not.toHaveBeenCalled();
  });

  it("403 when captcha fails", async () => {
    const res = await POST(makeRequest({ ...valid, turnstile_token: "bad" }));
    expect(res.status).toBe(403);
    expect(bugReportInsert).not.toHaveBeenCalled();
  });

  it("429 when ip exceeded 5 reports in the past hour", async () => {
    state.rateCount = 5;
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(429);
    expect(bugReportInsert).not.toHaveBeenCalled();
  });

  it("500 when insert errors", async () => {
    state.insertError = { message: "boom" };
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(500);
  });
});
