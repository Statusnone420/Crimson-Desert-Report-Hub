import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  passwordMatches: vi.fn(), rpc: vi.fn(), configured: vi.fn(() => true), generation: vi.fn(),
}));
vi.mock("@/lib/adminSessions.server", () => ({ currentSessionGeneration: mocks.generation }));
vi.mock("@/lib/session", async (original) => ({
  ...await original<typeof import("@/lib/session")>(), passwordMatches: mocks.passwordMatches,
}));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }), hasSupabaseServiceConfig: mocks.configured,
}));
import { POST, DELETE } from "@/app/api/admin/login/route";
import { verifySessionToken } from "@/lib/session";

const secret = "login-tests-only-01234567890123456789";
function request(body: unknown = { password: "test-password" }, headers: Record<string, string> = {}) {
  return new Request("https://site.example/api/admin/login", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
function outcome(data: unknown, error: unknown = null) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error }) };
}
beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", "test-password");
  vi.stubEnv("SESSION_SECRET", secret);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NODE_ENV", "production");
  mocks.passwordMatches.mockReset().mockResolvedValue(true);
  mocks.configured.mockReset().mockReturnValue(true);
  mocks.rpc.mockReset().mockReturnValue(outcome({ allowed: true, retry_after: 0 }));
  mocks.generation.mockReset().mockResolvedValue(1);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("admin login admission", () => {
  it("stops a denied attempt before password derivation or cookie issuance", async () => {
    mocks.rpc.mockReturnValue(outcome({ allowed: false, retry_after: 87 }));
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("87");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it("preserves a successful sign-in and its signed session", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    const cookie = res.cookies.get("cd_admin");
    expect(verifySessionToken(cookie?.value, secret, 1)).toBe(true);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.passwordMatches).toHaveBeenCalledExactlyOnceWith("test-password", "test-password", secret);
  });
  it("issues no session when the login generation cannot be read", async () => {
    mocks.generation.mockResolvedValue(null);
    const res = await POST(request());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "sign_in_unavailable" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("reserves before every comparison, including repeated successes", async () => {
    let count = 0;
    mocks.rpc.mockImplementation(() => outcome(++count <= 5
      ? { allowed: true, retry_after: 0 } : { allowed: false, retry_after: 900 }));
    const responses = await Promise.all(Array.from({ length: 20 }, () => POST(request())));
    expect(responses.filter((res) => res.status === 200)).toHaveLength(5);
    expect(responses.filter((res) => res.status === 429)).toHaveLength(15);
    expect(mocks.passwordMatches).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).toHaveBeenCalledTimes(20);
  });
  it("does not compare until the reservation is acknowledged", async () => {
    let acknowledge!: (value: unknown) => void;
    const pending = new Promise((resolve) => { acknowledge = resolve; });
    mocks.rpc.mockReturnValue({ abortSignal: () => pending });
    const response = POST(request());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
    acknowledge({ data: { allowed: true, retry_after: 0 }, error: null });
    expect((await response).status).toBe(200);
  });
  it("keeps a failed password distinct from unavailable admission", async () => {
    mocks.passwordMatches.mockResolvedValue(false);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it.each([null, [], {}, { allowed: "true", retry_after: 0 }, { allowed: true, retry_after: 1 },
    { allowed: false, retry_after: 0 }, { allowed: false, retry_after: "900" }, { allowed: false, retry_after: 901 },
  ])("fails closed on malformed RPC data %j", async (data) => {
    mocks.rpc.mockReturnValue(outcome(data));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it.each(["PGRST202", "42501", "57014", "XX000"])("fails closed on database error %s", async (code) => {
    mocks.rpc.mockReturnValue(outcome({ allowed: true, retry_after: 0 }, { code, message: "private detail" }));
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("private detail");
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it("fails closed on thrown transport errors and missing configuration", async () => {
    mocks.rpc.mockImplementation(() => { throw new Error("private transport details"); });
    expect((await POST(request())).status).toBe(503);
    mocks.rpc.mockClear();
    mocks.configured.mockReturnValue(false);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { password: 12 }, { password: true }, { password: {} },
    { password: ["test-password"] }, { password: "" }, { password: "a".repeat(1025) },
    { password: "é".repeat(513) },
  ])("rejects malformed password input without admission or crypto: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it("preserves whitespace, Unicode and JSON-escaped password bytes", async () => {
    const res = await POST(new Request("https://site.example/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
      body: '{"password":" \\u00e9\\u0020 "}',
    }));
    expect(res.status).toBe(200);
    expect(mocks.passwordMatches).toHaveBeenCalledWith(" é  ", "test-password", secret);
  });
  it("bounds the actual request stream even with a false Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"password":"test-password","padding":"'));
      controller.enqueue(new Uint8Array(8193).fill(65));
      controller.close();
    } });
    const req = new Request("https://site.example/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "10" }, body: stream,
      ...{ duplex: "half" },
    });
    expect((await POST(req)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["{", "", '{"password":"ok"} trailing'])("rejects invalid JSON %j", async (body) => {
    const res = await POST(new Request("https://site.example/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }));
    expect(res.status).toBe(400);
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it("rejects a form content type before reading its body", async () => {
    expect((await POST(request(undefined, { "content-type": "text/plain" }))).status).toBe(415);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("stores only a keyed identity and normalizes IPv6 spellings", async () => {
    await POST(request(undefined, { "x-forwarded-for": "2001:db8::1" }));
    await POST(request(undefined, { "x-forwarded-for": "2001:0db8:0:0:0:0:0:1" }));
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[0][0]).toBe("reserve_admin_login_attempt");
    expect(mocks.rpc.mock.calls[0][1]).toEqual({ p_address_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("2001:");
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("test-password");
  });
  it("keys every address in one IPv6 /64 as one identity", async () => {
    for (const value of ["2001:db8:1:2::1", "2001:db8:1:2:ffff::9%eth0", "2001:db8:1:3::1"]) {
      await POST(request(undefined, { "x-forwarded-for": value }));
    }
    const [first, sameNetwork, otherNetwork] = mocks.rpc.mock.calls.map((call) => call[1].p_address_hash);
    expect(sameNetwork).toBe(first);
    expect(otherNetwork).not.toBe(first);
  });
  it("uses one unattributed identity for absent, malformed, or chained forwarding headers", async () => {
    for (const value of ["", "garbage", "203.0.113.1, 203.0.113.2", "[2001:db8::1]"]) {
      expect((await POST(request(undefined, { "x-forwarded-for": value }))).status).toBe(200);
    }
    expect(new Set(mocks.rpc.mock.calls.map((call) => call[1].p_address_hash)).size).toBe(1);
  });
  it("ignores forwarding headers on hosts without the Vercel trust boundary", async () => {
    vi.stubEnv("VERCEL", "");
    await POST(request(undefined, { "x-forwarded-for": "203.0.113.1" }));
    await POST(request(undefined, { "x-forwarded-for": "203.0.113.2" }));
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it("blocks new Vercel-preview sign-ins before any database or crypto work", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "preview_sign_in_disabled" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.passwordMatches).not.toHaveBeenCalled();
  });
  it("keeps logout available without resetting the durable limit", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(res.cookies.get("cd_admin")).toMatchObject({ value: "", maxAge: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
