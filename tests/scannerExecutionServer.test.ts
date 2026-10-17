import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY } from "@/lib/automation/diagnostics";

const mocks = vi.hoisted(() => ({ isAdmin: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
import { getScannerExecution } from "@/lib/automation/execution.server";

const account = "1".repeat(32);
const namespace = "2".repeat(32);
const start = { id: "214ff53e-dc69-4792-90b0-ea074a137685", startedAt: "2026-09-12T15:00:00.000Z" };
const snapshot = {
  version: 1, latestAttempt: { ...start, finishedAt: "2026-09-12T15:01:00.000Z", outcome: "failed", diagnostics: [{ stage: "run_create", code: "database_timeout" }], errorCount: 1, skipReason: null, nextEligibleAt: null, httpStatus: 503 },
  lastSuccessfulScanAt: "2026-09-12T12:05:00.000Z", lastSuccessfulAiAt: "2026-09-12T12:05:00.000Z", lastFailedAttempt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", account);
  vi.stubEnv("CLOUDFLARE_SCANNER_KV_NAMESPACE_ID", namespace);
  vi.stubEnv("CLOUDFLARE_SCANNER_STATUS_TOKEN", "private-read-token");
  mocks.isAdmin.mockResolvedValue(true);
  mocks.fetch.mockImplementation(async (url: string) => Response.json(url.endsWith(SCANNER_ATTEMPT_START_KEY) ? start : snapshot));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T15:02:00.000Z"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("private Cloudflare scanner record read", () => {
  it("requires an admin before looking up credentials or calling Cloudflare", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    expect(await getScannerExecution()).toMatchObject({ state: "unavailable", code: "admin_required", snapshot: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not connect preview deployments to production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await getScannerExecution()).toMatchObject({ state: "preview" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("names missing configuration instead of implying a healthy trigger", async () => {
    vi.stubEnv("CLOUDFLARE_SCANNER_STATUS_TOKEN", "");
    expect(await getScannerExecution()).toMatchObject({ state: "not_configured", snapshot: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed account paths before transmitting a token", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "../another/account");
    expect(await getScannerExecution()).toMatchObject({ code: "configuration_invalid" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("reads only two fixed private keys, without caching, redirects, or writes", async () => {
    const result = await getScannerExecution();
    expect(result).toMatchObject({ state: "available", started: start, snapshot });
    expect(mocks.fetch.mock.calls.map((call) => call[0])).toEqual([SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY].map((key) => `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/values/${key}`));
    for (const call of mocks.fetch.mock.calls) expect(call[1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer private-read-token" } });
    expect(JSON.stringify(result)).not.toContain("private-read-token");
  });
  it.each([401, 403, 429, 503])("surfaces HTTP %s instead of empty history", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("private error text", { status }));
    const result = await getScannerExecution();
    expect(result.state).toBe("unavailable");
    expect(result.code).toBe(status === 401 || status === 403 ? "access_denied" : status === 429 ? "rate_limited" : "service_unavailable");
    expect(JSON.stringify(result)).not.toContain("private error text");
  });
  it("does not call an unverified namespace's 404 an empty history", async () => {
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 404 }));
    expect(await getScannerExecution()).toMatchObject({ state: "unavailable", code: "namespace_unverified" });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("recognizes first capture pending only after a namespace verification", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.includes("/values/") ? new Response(null, { status: 404 }) : Response.json({ success: true, result: { id: namespace } }));
    expect(await getScannerExecution()).toMatchObject({ state: "no_attempt", code: "first_attempt_pending" });
  });
  it("keeps a valid start when the completion record read fails", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith(SCANNER_ATTEMPT_START_KEY) ? Response.json(start) : new Response(null, { status: 503 }));
    expect(await getScannerExecution()).toMatchObject({ state: "unavailable", started: start, snapshot: null, code: "service_unavailable" });
  });
  it.each(["not JSON", JSON.stringify({ padding: "x".repeat(33 * 1024) }), JSON.stringify({ ...snapshot, version: 2 })])("rejects malformed, oversized, or unsupported records", async (body) => {
    mocks.fetch.mockImplementation(async () => new Response(body));
    expect(await getScannerExecution()).toMatchObject({ state: "unavailable", code: "invalid_response" });
  });
  it("rejects future trigger evidence", async () => {
    mocks.fetch.mockImplementation(async () => Response.json({ ...start, startedAt: "2026-09-13T15:00:00.000Z" }));
    expect((await getScannerExecution()).state).toBe("unavailable");
  });
  it("does not copy extra stored fields to the console", async () => {
    mocks.fetch.mockImplementation(async (url: string) => Response.json({ ...(url.endsWith(SCANNER_ATTEMPT_START_KEY) ? start : snapshot), raw_text: "private-source-text", secret: "private-read-token" }));
    const result = await getScannerExecution();
    expect(result.state).toBe("available");
    expect(JSON.stringify(result)).not.toMatch(/private-source-text|private-read-token/);
  });
});
