import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const countChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "bug_reports") throw new Error(`unexpected table ${table}`);
      return {
        insert: insertMock,
        select: countChain.select,
        eq: countChain.eq,
        gte: countChain.gte,
      };
    },
  }),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn(async (token: string | undefined) =>
    token === "good" || token === undefined
      ? { ok: token === "good", skipped: false }
      : { ok: false, skipped: false },
  ),
}));

process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

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
  insertMock.mockReset().mockResolvedValue({ data: null, error: null });
  countChain.select.mockClear().mockReturnThis();
  countChain.eq.mockClear().mockReturnThis();
  countChain.gte.mockReset().mockResolvedValue({ count: 0, error: null });
});

describe("POST /api/reports", () => {
  it("201 on valid report; inserts pending with fingerprint and ip hash, no raw ip", async () => {
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledOnce();
    const row = insertMock.mock.calls[0][0];
    expect(row.moderation_status).toBe("pending");
    expect(row.duplicate_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(row.submitter_ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.turnstile_token).toBeUndefined();
  });

  it("400 on invalid json and on validation failure", async () => {
    const bad = new Request("http://localhost/api/reports", { method: "POST", body: "{not json" });
    expect((await POST(bad)).status).toBe(400);
    expect((await POST(makeRequest({ ...valid, issue_title: "x" }))).status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("403 when captcha fails", async () => {
    const res = await POST(makeRequest({ ...valid, turnstile_token: "bad" }));
    expect(res.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("429 when ip exceeded 5 reports in the past hour", async () => {
    countChain.gte.mockResolvedValue({ count: 5, error: null });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("500 when insert errors", async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(500);
  });
});
