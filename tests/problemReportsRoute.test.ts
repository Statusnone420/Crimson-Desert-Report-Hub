import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashIp } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), captcha: vi.fn(), preview: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }), hasSupabaseServiceConfig: mocks.configured }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.preview }));
vi.mock("@/lib/turnstile", async (original) => ({ ...await original<typeof import("@/lib/turnstile")>(), verifyProblemReportTurnstile: mocks.captcha }));
import { POST } from "@/app/api/problem-reports/route";

const origin = "https://crimsonreporthub.com";
const body = { type: "broken_link", description: "The source link returns a 404.", page_url: `${origin}/news?secret=private#personal`, turnstile_token: "fresh-token" };
const request = (value: unknown = body, headers: Record<string, string> = {}) => new Request(`${origin}/api/problem-reports`, { method: "POST", headers: { "content-type": "application/json", origin, "x-forwarded-for": "203.0.113.7", ...headers }, body: JSON.stringify(value) });

beforeEach(() => {
  vi.clearAllMocks(); mocks.preview.mockReturnValue(false); mocks.configured.mockReturnValue(true);
  mocks.captcha.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: { outcome: "created" }, error: null });
  vi.stubEnv("PROBLEM_REPORT_IP_SALT", "private-fixture-salt-at-least-32-characters");
  vi.stubEnv("PROBLEM_REPORT_TURNSTILE_SECRET_KEY", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("private public-facing intake", () => {
  it("stores a pending report with only a salted hash and clean URL, returning no private data", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("record_site_problem_report", {
      p_type: "broken_link", p_description: body.description, p_page_url: `${origin}/news`, p_email: null,
      p_ip_hash: hashIp("203.0.113.7", process.env.PROBLEM_REPORT_IP_SALT!),
      p_token_hash: createHash("sha256").update("fresh-token").digest("hex"),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("203.0.113.7");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("fresh-token");
  });
  it("refuses a token the database has already used, even when Siteverify accepts it again", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "replayed" }, error: null });
    const response = await POST(request(body, { "x-forwarded-for": "198.51.100.24" }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "captcha_failed" });
    expect(mocks.captcha).toHaveBeenCalledOnce();
  });
  it("rejects previews and cross-site requests before any provider or database call", async () => {
    mocks.preview.mockReturnValue(true); expect((await POST(request())).status).toBe(403);
    mocks.preview.mockReturnValue(false); expect((await POST(request(body, { origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(body, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(request(body, { origin: "" }))).status).toBe(403);
    expect(mocks.captcha).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses malformed, oversized, empty and spam payloads before verification", async () => {
    for (const payload of [{ ...body, type: "remove_content" }, { ...body, description: "  " }, { ...body, description: "https://spam.test" }, { ...body, description: "x".repeat(17000) }, { ...body, page_url: "https://other.test/news" }]) expect((await POST(request(payload))).status).toBe(400);
    expect((await POST(request(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect(mocks.captcha).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("counts one IPv6 /64 as one network and keeps IPv4 keys unchanged", async () => {
    const salt = process.env.PROBLEM_REPORT_IP_SALT!;
    const hashFor = async (ip: string) => {
      mocks.rpc.mockClear(); expect((await POST(request(body, { "x-forwarded-for": ip }))).status).toBe(201);
      return mocks.rpc.mock.calls[0][1].p_ip_hash;
    };
    const network = await hashFor("2001:db8:1:2::7");
    expect(network).toBe(hashIp("2001:db8:1:2::/64", salt));
    expect(await hashFor("2001:0DB8:0001:0002:abcd:0:0:9, 198.51.100.1")).toBe(network);
    expect(await hashFor("2001:db8:1:3::7")).not.toBe(network);
    expect(await hashFor("203.0.113.7")).toBe(hashIp("203.0.113.7", salt));
    expect(await hashFor("::ffff:203.0.113.7")).toBe(hashIp("203.0.113.7", salt));
  });
  it("fails closed without configuration or a trusted valid network address", async () => {
    for (const ip of ["", "unknown", "203.0.113.7:443", "[2001:db8::1]"]) expect((await POST(request(body, { "x-forwarded-for": ip }))).status).toBe(503);
    vi.stubEnv("PROBLEM_REPORT_IP_SALT", "short"); expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses failed/replayed Turnstile tokens without saving", async () => {
    mocks.captcha.mockResolvedValue(false); expect((await POST(request())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns the database's shared daily limit without exposing a row", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "rate_limited", retry_after: 86400 }, error: null });
    const response = await POST(request()); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("86400"); expect(await response.json()).toEqual({ error: "rate_limited" });
  });
  it.each([{ code: "PGRST202", message: "Could not find record_site_problem_report in schema cache" }, { code: "42501", message: "permission denied for site_problem_reports" }])("surfaces missing schema and database failures without logging payloads", async (error) => {
    mocks.rpc.mockResolvedValue({ data: null, error }); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("permission denied");
  });
});
