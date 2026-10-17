import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), client: vi.fn(), dashboard: vi.fn(), connection: vi.fn(), rpc: vi.fn(),
  seal: vi.fn(), check: vi.fn(), models: vi.fn(), inspect: vi.fn(), test: vi.fn() }));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.admin }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/aiSettings/store.server", () => ({ readAiDashboard: mocks.dashboard, readAiConnection: mocks.connection, aiRpc: mocks.rpc }));
vi.mock("@/lib/aiSettings/credentials.server", () => ({ sealAiKey: mocks.seal }));
vi.mock("@/lib/aiSettings/provider.server", async () => ({ ...await vi.importActual<typeof import("@/lib/aiSettings/provider.server")>("@/lib/aiSettings/provider.server"),
  checkOpenRouterConnection: mocks.check, listOpenRouterModels: mocks.models }));
vi.mock("@/lib/aiSettings/service.server", async () => ({ ...await vi.importActual<typeof import("@/lib/aiSettings/service.server")>("@/lib/aiSettings/service.server"),
  inspectAiProfile: mocks.inspect, runAiTest: mocks.test }));

import { GET, POST } from "@/app/api/admin/ai-settings/route";
import { AiProviderError } from "@/lib/aiSettings/provider.server";
import { SITE_URL } from "@/lib/site";

const client = { name: "private-service-fixture" };
const input = { modelId: "fixture/model", reasoning: "default", retention: "standard", maxOutputTokens: 1024 };
const untrustedHeaders: Record<string, string>[] = [
  { origin: "https://attacker.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" },
  { origin: `${SITE_URL}.attacker.invalid` },
];
function request(command: unknown = { action: "catalog" }, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}/api/admin/ai-settings`, { method: "POST",
    headers: { "content-type": "application/json", origin: SITE_URL, ...headers }, body: JSON.stringify(command) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
  mocks.admin.mockResolvedValue(true);
  mocks.client.mockReturnValue(client);
  mocks.dashboard.mockResolvedValue({ available: true, configuration: { revision: 7 } });
  mocks.connection.mockResolvedValue({ key: "PRIVATE_SAVED_CREDENTIAL" });
  mocks.rpc.mockResolvedValue({}); mocks.seal.mockReturnValue("encrypted-envelope");
  mocks.check.mockResolvedValue(undefined); mocks.models.mockResolvedValue([]);
  mocks.test.mockResolvedValue({ passed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("AI settings HTTP boundary", () => {
  it("requires an admin session before reading settings, creating clients, or calling providers", async () => {
    mocks.admin.mockResolvedValue(false);
    for (const result of [await GET(), await POST(request())]) {
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({ error: "unauthorized" });
    }
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.dashboard).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled();
  });

  it.each([
    ["production", "preview"], ["development", ""], ["test", "production"], ["production", ""],
  ])("blocks provider access outside the production deployment (%s/%s)", async (nodeEnv, vercelEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv); vi.stubEnv("VERCEL_ENV", vercelEnv);
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ action: "connection", key: "fixture-long-provider-key", version: 0 }))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(untrustedHeaders)("rejects an untrusted or cross-site mutation before touching services", async (headers) => {
    const result = await POST(request({ action: "catalog" }, headers));
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: "invalid_origin" });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("accepts the configured production deployment origin and returns private non-cacheable JSON", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "fixture-project.vercel.app");
    const result = await POST(request({ action: "catalog" }, { origin: "https://fixture-project.vercel.app" }));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await result.json()).toEqual({ models: [] });
    expect(mocks.models).toHaveBeenCalledWith("PRIVATE_SAVED_CREDENTIAL");
  });

  it("requires JSON and enforces both declared and actual body size", async () => {
    expect((await POST(request({}, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ action: "catalog" }, { "content-length": "8193" }))).status).toBe(422);
    expect((await POST(request({ action: "catalog", extra: "x".repeat(8193) }))).status).toBe(422);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and unknown command fields without forwarding them", async () => {
    const malformed = new Request(`${SITE_URL}/api/admin/ai-settings`, { method: "POST",
      headers: { origin: SITE_URL, "content-type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(422);
    expect((await POST(request({ action: "catalog", rawPrompt: "PRIVATE" }))).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("checks encryption and connection before saving only ciphertext with the expected generation", async () => {
    const key = "fixture-long-provider-key";
    const result = await POST(request({ action: "connection", key, version: 3 }));
    expect(result.status).toBe(200);
    expect(mocks.seal).toHaveBeenCalledWith(key); expect(mocks.check).toHaveBeenCalledWith(key);
    expect(mocks.seal.mock.invocationCallOrder[0]).toBeLessThan(mocks.check.mock.invocationCallOrder[0]);
    expect(mocks.check.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(client, "ai_connection_save", { p_ciphertext: "encrypted-envelope", p_expected_version: 3 });
    expect(JSON.stringify(await result.json())).not.toContain(key);
  });

  it("does not contact the provider or save when encryption is unavailable", async () => {
    mocks.seal.mockImplementation(() => { throw new Error("encryption_not_configured"); });
    const result = await POST(request({ action: "connection", key: "fixture-long-provider-key", version: 0 }));
    expect(result.status).toBe(422); expect(await result.json()).toEqual({ error: "encryption_not_configured" });
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes validated test IDs to the bounded test service without activating or publishing", async () => {
    const id = "11000000-0000-4000-8000-000000000001";
    const quote = "a".repeat(64);
    const result = await POST(request({ action: "test", id, input, quote }));
    expect(await result.json()).toEqual({ test: { passed: true } });
    expect(mocks.test).toHaveBeenCalledExactlyOnceWith(client, id, input, quote, undefined, { startedAtMs: expect.any(Number), signal: expect.any(AbortSignal) });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.dashboard).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed quotes before starting a paid test", async () => {
    for (const quote of [undefined, "", "not-a-quote", "g".repeat(64)]) {
      expect((await POST(request({ action: "test", id: "11000000-0000-4000-8000-000000000001", input, quote }))).status).toBe(400);
    }
    expect(mocks.test).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("starts the qualification budget before slow authentication", async () => {
    vi.useFakeTimers(); const startedAtMs = Date.now();
    mocks.admin.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 10_000)));
    const incoming = request({ action: "test", id: "11000000-0000-4000-8000-000000000001", input, quote: "a".repeat(64) });
    const pending = POST(incoming);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(200);
    expect(mocks.test.mock.calls[0][5]).toEqual({ startedAtMs, signal: incoming.signal });
  });

  it("stops a stalled command body within preflight without starting services", async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    const incoming = new Request(`${SITE_URL}/api/admin/ai-settings`, { method: "POST",
      headers: { origin: SITE_URL, "content-type": "application/json" },
      body: new ReadableStream({ cancel: cancelled }), duplex: "half" } as RequestInit);
    const pending = POST(incoming);
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await pending;
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ error: "qualification_deadline" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(mocks.test).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "activate", revision: 7, testId: "11000000-0000-4000-8000-000000000001", role: "backup" },
      { p_revision: 7, p_test_id: "11000000-0000-4000-8000-000000000001", p_role: "backup" }],
    [{ action: "rollback", revision: 7 }, { p_revision: 7, p_test_id: null, p_role: "rollback" }],
  ])("preserves revision and activation role at the database boundary", async (command, args) => {
    expect((await POST(request(command))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(client, "ai_settings_activate", args);
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.test).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("PRIVATE_SQL_PASSWORD_PROVIDER_BODY"), 503, "ai_settings_unavailable"],
    [new Error("ai_revision_conflict"), 409, "ai_revision_conflict"],
    [new Error("ai_spending_blocked"), 422, "ai_spending_blocked"],
    [new AiProviderError("authentication"), 422, "provider_authentication"],
  ])("serializes only safe error codes", async (error, status, code) => {
    mocks.models.mockRejectedValue(error);
    const result = await POST(request());
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ error: code });
  });
});
