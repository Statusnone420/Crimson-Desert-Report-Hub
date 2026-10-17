import { afterEach, describe, expect, it, vi } from "vitest";
import { problemReportSchema, problemReportUpdateSchema } from "@/lib/problemReportSchema";
import { problemPageUrl, problemSameOrigin, readProblemJson } from "@/lib/problemReportHttp.server";

const valid = { type: "broken_link", description: "The source link on this page returns a 404.", page_url: "https://crimsonreporthub.com/news", turnstile_token: "token" };
afterEach(() => vi.unstubAllEnvs());

describe("private problem validation", () => {
  it("accepts normal reports without email and trims the message", () => {
    expect(problemReportSchema.parse({ ...valid, description: "  Broken source link  " })).toMatchObject({ email: null, description: "Broken source link" });
  });
  it("requires valid email only for creator requests", () => {
    expect(problemReportSchema.safeParse({ ...valid, type: "remove_content" }).success).toBe(false);
    expect(problemReportSchema.safeParse({ ...valid, type: "remove_content", email: "creator@example.test" }).success).toBe(true);
    expect(problemReportSchema.safeParse({ ...valid, email: "bad" }).success).toBe(false);
  });
  it.each(["", " \n ", "!!!", "x".repeat(2001), "https://spam.test", "www.spam.test", "spam.test", "Visit https://a.test https://b.test https://c.test for more details"])("refuses empty, oversized, or link-spam messages", (description) => {
    expect(problemReportSchema.safeParse({ ...valid, description }).success).toBe(false);
  });
  it("allows explanatory prose with a source and refuses public/status injection", () => {
    expect(problemReportSchema.safeParse({ ...valid, description: "The correct source for this story is https://publisher.test/notice" }).success).toBe(true);
    expect(problemReportSchema.safeParse({ ...valid, description: "404 at https://publisher.test/notice" }).success).toBe(true);
    expect(problemReportSchema.safeParse({ ...valid, status: "approved" }).success).toBe(false);
    expect(problemReportUpdateSchema.safeParse({ revision: 0, description: "rewrite" }).success).toBe(false);
    expect(problemReportUpdateSchema.safeParse({ revision: 0, status: "published" }).success).toBe(false);
    expect(problemReportUpdateSchema.safeParse({ revision: 0, note: "  " }).success).toBe(false);
    expect(problemReportUpdateSchema.safeParse({ revision: 0, status: "approved", note: "Creator verification pending" }).success).toBe(true);
  });
  it("strips private URL components and refuses foreign/credentialed URLs", () => {
    expect(problemPageUrl("https://crimsonreporthub.com/news?email=private@example.test#token", valid.page_url)).toBe("https://crimsonreporthub.com/news");
    for (const value of ["javascript:alert(1)", "https://other.test/news", "https://user:pass@crimsonreporthub.com/news", "http://crimsonreporthub.com/news"]) expect(problemPageUrl(value, valid.page_url)).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(problemPageUrl("http://localhost:3000/news", "http://localhost:3000/api/problem-reports")).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    expect(problemPageUrl("http://localhost:3000/news?secret=x", "http://localhost:3000/api/problem-reports")).toBe("http://localhost:3000/news");
    expect(problemPageUrl("http://127.0.0.1:3000/news?secret=x", "http://localhost:3000/api/problem-reports")).toBe("http://127.0.0.1:3000/news");
  });
  it("handles Next's development loopback alias while rejecting different ports and production loopback", () => {
    const request = (origin: string) => new Request("http://localhost:3000/api/problem-reports", { headers: { origin } });
    vi.stubEnv("NODE_ENV", "development");
    expect(problemSameOrigin(request("http://127.0.0.1:3000"))).toBe(true);
    expect(problemSameOrigin(request("http://127.0.0.1:4000"))).toBe(false);
    expect(problemSameOrigin(request("https://evil.test"))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(problemSameOrigin(request("http://127.0.0.1:3000"))).toBe(false);
  });
  it("bounds streamed JSON without trusting Content-Length", async () => {
    const request = new Request("https://crimsonreporthub.com/api/problem-reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "x".repeat(17000) }) });
    await expect(readProblemJson(request)).rejects.toThrow("invalid_request");
  });
});
