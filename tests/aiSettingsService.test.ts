import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { inspectAiProfile, runAiTest, type SetupInput } from "@/lib/aiSettings/service.server";
import { emptyConfiguration, type AiClient } from "@/lib/aiSettings/store.server";
import { evaluateAiTestCase } from "@/lib/aiSettings/testSuite";

const input: SetupInput = { endpointTag: "fixture/fp8", modelId: "fixture/text", reasoning: "default", retention: "standard", maxOutputTokens: 1024 };
const id = "11000000-0000-4000-8000-000000000001";
const sourceMarker = "PRIVATE_PROVIDER_OUTPUT";
const extraction = { issueTitle: "Opening the map freezes the game", category: "crash_startup", platform: null, confidence: "high",
  summary: sourceMarker, clusterAssignment: "sure", clusterReason: sourceMarker, clusterSlug: "map-freeze" };
const validCases = { map: extraction, uncertain: { ...extraction, clusterAssignment: "unsure", clusterSlug: null }, injection: extraction,
  exact: { matchKind: "sure", clusterSlug: "map-freeze", reason: sourceMarker },
  broad: { matchKind: "unsure", clusterSlug: null, reason: sourceMarker },
  distinct: { matchKind: "sure", clusterSlug: "travel-crash", reason: sourceMarker } };

function fixture(options: { duplicate?: boolean; requestUsd?: number; insertError?: boolean; settlementError?: boolean;
  reservationDelayMs?: number; settlementDelayMs?: number; insertDelayMs?: number; configurationDelayMs?: number; spendingBlocked?: boolean } = {}) {
  const writes: { table: string; row: unknown }[] = [];
  const signals: AbortSignal[] = [];
  const delayed = <T>(value: T, ms = 0) => ms ? new Promise<T>((resolve) => setTimeout(() => resolve(value), ms)) : Promise.resolve(value);
  const abortable = <T>(value: Promise<T>) => Object.assign(value, { abortSignal: (signal: AbortSignal) => { signals.push(signal); return value; } });
  const configuration = emptyConfiguration();
  if (options.requestUsd !== undefined) configuration.policy.requestUsd = options.requestUsd;
  const from = vi.fn((table: string) => {
    if (!["ai_settings_state", "ai_connections", "ai_model_tests"].includes(table)) throw new Error(`Unexpected data access: ${table}`);
    const query = { select: () => query, eq: () => query, abortSignal: (signal: AbortSignal) => { signals.push(signal); return query; },
      limit: () => delayed({ data: table === "ai_settings_state"
      ? [{ revision: 0, configuration }] : [], error: null }, table === "ai_settings_state" ? options.configurationDelayMs : 0),
    insert: (row: unknown) => { writes.push({ table, row: structuredClone(row) }); return abortable(delayed({ error: options.insertError ? { message: "PRIVATE_DATABASE_DETAIL" } : null }, options.insertDelayMs)); } };
    return query;
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === "ai_test_reserve") return abortable(delayed({ data: { state: "reserved", firstAcknowledgement: !options.duplicate, reservedUsd: args.p_usd }, error: options.spendingBlocked ? { message: "ai_spending_blocked" } : null }, options.reservationDelayMs));
    if (name === "ai_test_settle") return abortable(delayed({ data: { state: args.p_state }, error: options.settlementError ? { message: "PRIVATE_DATABASE_DETAIL" } : null }, options.settlementDelayMs));
    throw new Error(`Unexpected mutation: ${name}`);
  });
  return { client: { from, rpc } as unknown as AiClient, from, rpc, writes, signals };
}

function network(options: { modelId?: string; endpointTag?: string; promptPrice?: string; completionPrice?: string; extraPricing?: Record<string, unknown>; response?: (init: RequestInit | undefined, index: number) => Response | Promise<Response>; context?: number; endpoints?: unknown[] } = {}) {
  let dispatched = 0;
  const modelId = options.modelId ?? input.modelId; const tag = options.endpointTag ?? input.endpointTag;
  return vi.fn<typeof fetch>(async (url, init) => {
    const pricing = { prompt: options.promptPrice ?? "0.00000001", completion: options.completionPrice ?? "0.00000002", ...options.extraPricing };
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: modelId, name: "Fixture text model",
      context_length: options.context ?? 65_536, top_provider: { max_completion_tokens: 8192 },
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing,
      supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"] }] });
    if (url === `https://openrouter.ai/api/v1/models/${modelId}/endpoints`) return Response.json({ data: { id: modelId,
      endpoints: options.endpoints ?? [{ model_id: modelId, provider_name: "Fixture provider", tag, status: 0,
        context_length: options.context ?? 65_536, max_completion_tokens: 8192, max_prompt_tokens: null, pricing,
        supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"] }] } });
    if (url === "https://openrouter.ai/api/v1/endpoints/zdr") return Response.json({ data: [{ model_id: modelId, tag, status: 0 }] });
    if (url !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Unexpected network destination");
    const index = dispatched++ % 6;
    return options.response ? options.response(init, index) : responseForCase(index);
  });
}
function responseForCase(index: number, cost = 0.00001) {
  return Response.json({ usage: { cost }, choices: [{ message: { content: JSON.stringify(Object.values(validCases)[index]) } }] });
}
const dispatches = (fetcher: ReturnType<typeof network>) => fetcher.mock.calls.filter(([url]) => url === "https://openrouter.ai/api/v1/chat/completions");
async function runQuotedTest(client: AiClient, testId: string, setup: SetupInput, fetcher: typeof fetch) {
  const inspection = await inspectAiProfile(client, setup, fetcher);
  return runAiTest(client, testId, setup, inspection.quote ?? "0".repeat(64), fetcher);
}
beforeEach(() => { vi.stubEnv("OPENROUTER_API_KEY", "fixture-provider-credential-private"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("paid AI setup test boundary", () => {
  it("qualifies six independent production requests with production output ceilings", async () => {
    const db = fixture(); const fetcher = network();
    const setup = { ...input, reasoning: "high" as const, retention: "zdr" as const, maxOutputTokens: 3200 };
    await runQuotedTest(db.client, id, setup, fetcher);
    const requests = dispatches(fetcher).map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests).toHaveLength(6);
    expect(requests.map((request) => request.max_tokens)).toEqual([3200, 3200, 3200, 2048, 2048, 2048]);
    expect(requests.map((request) => request.response_format.json_schema.name)).toEqual([
      ...Array(3).fill("crimson_desert_issue_signal"), ...Array(3).fill("crimson_desert_claim_mapping"),
    ]);
    for (const request of requests) {
      expect(request.provider).toMatchObject({ only: ["fixture/fp8"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true });
      expect(request.reasoning).toEqual({ effort: "high", exclude: true });
      expect(request.response_format.json_schema.strict).toBe(true);
    }
  });

  it("reserves the approved aggregate maximum at the reviewed Morph rates before all six dispatches", async () => {
    const db = fixture();
    const setup = { modelId: "deepseek/deepseek-v4.1-flash", endpointTag: "morph/fp8", reasoning: "high" as const, retention: "zdr" as const, maxOutputTokens: 3200 };
    const fetcher = network({ ...setup, promptPrice: "0.000000026", completionPrice: "0.000000377" });
    const inspected = await inspectAiProfile(db.client, setup, fetcher);
    expect(inspected.testCeilingUsd).toBe(0.006397302);
    const result = await runAiTest(db.client, id, setup, inspected.quote!, fetcher);
    expect(result.reservedUsd).toBe(0.006397302);
    expect(db.rpc).toHaveBeenNthCalledWith(1, "ai_test_reserve", { p_id: id, p_usd: 0.006397302 });
    const indices = fetcher.mock.calls.flatMap(([url], i) => String(url).endsWith("/chat/completions") ? [i] : []);
    expect(indices).toHaveLength(6);
    for (const i of indices) expect(fetcher.mock.invocationCallOrder[i]).toBeGreaterThan(db.rpc.mock.invocationCallOrder[0]);
    expect(result.cases.map((item) => item.attempt?.reservedUsd)).toEqual([0.001301743, 0.001302315, 0.001302548, 0.000830518, 0.000830154, 0.000830024]);
  });

  it("does not let a previously reviewed bundled quote authorize a six-request batch", async () => {
    const db = fixture(); const fetcher = network(); const inspection = await inspectAiProfile(db.client, input, fetcher);
    const metadata = inspection.metadata;
    const oldProfile = { provider: "openrouter", modelId: input.modelId, reasoning: input.reasoning, retention: input.retention, maxOutputTokens: input.maxOutputTokens,
      connectionVersion: 0, metadata: { ...metadata, fetchedAt: null,
        supportedParameters: metadata.supportedParameters?.toSorted() ?? null, reasoningEfforts: metadata.reasoningEfforts?.toSorted() ?? null,
        inputModalities: metadata.inputModalities.toSorted(), outputModalities: metadata.outputModalities.toSorted() } };
    const oldQuote = createHash("sha256").update(JSON.stringify(oldProfile)).digest("hex");
    await expect(runAiTest(db.client, id, input, oldQuote, fetcher)).rejects.toThrow("ai_quote_changed");
    expect(db.rpc).not.toHaveBeenCalled(); expect(dispatches(fetcher)).toHaveLength(0);
  });
  it("requires an explicit endpoint and never replaces an unavailable selection", async () => {
    for (const endpointTag of [undefined, "", "missing/fp8"]) {
      const db = fixture(); const fetcher = network();
      const setup = { ...input, endpointTag };
      const inspection = await inspectAiProfile(db.client, setup, fetcher);
      expect(inspection).toMatchObject({ compatible: false, quote: null, endpoints: [{ tag: "fixture/fp8", name: "Fixture provider" }] });
      await expect(runAiTest(db.client, id, setup, "0".repeat(64), fetcher)).rejects.toThrow(/^no_compatible_endpoint$/);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(dispatches(fetcher)).toHaveLength(0);
    }
  });

  it("blocks a stale rate quote, then tests a reviewed quote with the same privacy, route and spending limits", async () => {
    const setup = { ...input, reasoning: "high" as const, retention: "zdr" as const, maxOutputTokens: 768 };
    const db = fixture();
    const old = await inspectAiProfile(db.client, setup, network({ promptPrice: "0.000000021", completionPrice: "0.000000383" }));
    const fetcher = network({ promptPrice: "0.000000027", completionPrice: "0.000000383" });
    await expect(runAiTest(db.client, id, setup, old.quote!, fetcher)).rejects.toThrow(/^ai_quote_changed$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
    const fresh = await inspectAiProfile(db.client, setup, fetcher);
    expect(fresh.quote).not.toBe(old.quote);
    const result = await runAiTest(db.client, id, setup, fresh.quote!, fetcher);
    expect(result).toMatchObject({ passed: true, costState: "verified" });
    expect(result.reservedUsd).toBeLessThanOrEqual(0.01);
    const request = JSON.parse(String(dispatches(fetcher)[0][1]?.body));
    expect(request.provider).toEqual({ only: ["fixture/fp8"], allow_fallbacks: false, require_parameters: true,
      data_collection: "deny", zdr: true, max_price: { prompt: 0.027, completion: 0.383, request: 0, image: 0 } });
    expect(request.reasoning).toEqual({ effort: "high", exclude: true });
    expect(request.max_tokens).toBe(768);
    expect(request.response_format.json_schema.strict).toBe(true);
    const capped = fixture({ requestUsd: 0.000001 });
    await expect(runAiTest(capped.client, id, setup, fresh.quote!, fetcher)).rejects.toThrow(/^test_exceeds_limit$/);
    expect(capped.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(6);
  });

  it("quotes a capable endpoint instead of combining the cheapest price with model-wide capabilities", async () => {
    const db = fixture();
    const fetcher = network({ promptPrice: "0.00000002", completionPrice: "0.0000006" });
    const catalogFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/endpoints")) return Response.json({ data: { id: input.modelId, endpoints: [
        { model_id: input.modelId, provider_name: "Cheapest", tag: "cheapest", status: 0, context_length: 65_536,
          max_completion_tokens: 8192, supported_parameters: ["max_tokens", "reasoning"],
          pricing: { prompt: "0.00000002", completion: "0.0000006" } },
        { model_id: input.modelId, provider_name: "Compatible", tag: "compatible/fp8", status: 0, context_length: 32_768,
          max_completion_tokens: 4096, supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"],
          pricing: { prompt: "0.000000021", completion: "0.000000383" } },
      ] } });
      return catalogFetch(url, init);
    });
    const setup = { ...input, endpointTag: "compatible/fp8" };
    const inspection = await inspectAiProfile(db.client, setup, fetcher);
    expect(inspection).toMatchObject({ compatible: true, metadata: {
      endpoint: { tag: "compatible/fp8", name: "Compatible" },
      contextWindow: 32_768, maxOutputTokens: 4096, inputUsdPerMillion: 0.021, outputUsdPerMillion: 0.383,
    } });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
    const result = await runAiTest(db.client, id, setup, inspection.quote!, fetcher);
    expect(result.profile.metadata.endpoint?.tag).toBe("compatible/fp8");
    expect(result.reservedUsd).toBe(inspection.testCeilingUsd);
    expect(JSON.parse(String(dispatches(fetcher)[0][1]?.body)).provider).toMatchObject({
      only: ["compatible/fp8"], allow_fallbacks: false, require_parameters: true,
      max_price: { prompt: 0.021, completion: 0.383, request: 0, image: 0 },
    });
  });

  it("reserves once, evaluates all six scanner cases, and stores only a private sanitized receipt", async () => {
    const db = fixture(); const fetcher = network();
    const result = await runQuotedTest(db.client, id, input, fetcher);
    expect(result).toMatchObject({ id, passed: true, outcome: "passed", costState: "verified", costUsd: 0.00006 });
    expect(result.cases).toHaveLength(6);
    expect(result.cases.every((item) => item.passed)).toBe(true);
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["ai_test_reserve", "ai_test_settle"]);
    const dispatchIndex = fetcher.mock.calls.findIndex(([url]) => url === "https://openrouter.ai/api/v1/chat/completions");
    expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[dispatchIndex]);
    expect(db.rpc.mock.invocationCallOrder[1]).toBeGreaterThan(fetcher.mock.invocationCallOrder[dispatchIndex]);
    expect(dispatches(fetcher)).toHaveLength(6);
    expect(db.writes).toEqual([{ table: "ai_model_tests", row: expect.objectContaining({ id, result, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }) }]);
    expect(JSON.stringify(db.writes)).not.toMatch(/PRIVATE_PROVIDER_OUTPUT|fixture-provider-credential-private/);
    expect(db.from.mock.calls.every(([table]) => table.startsWith("ai_"))).toBe(true);
    const request = JSON.parse(String(dispatches(fetcher)[0][1]?.body));
    expect(request.provider.max_price).toMatchObject({ request: 0, image: 0 });
    expect(request.max_tokens).toBe(1024);
    expect(request.messages[1].content).not.toContain("expected");
  });

  it.each([
    { promptPrice: "0.000000011" },
    { completionPrice: "0.00000003" },
    { context: 32_768 },
  ])("requires review of a changed endpoint quote before reserving or dispatching: %j", async (change) => {
    const db = fixture();
    const inspection = await inspectAiProfile(db.client, input, network());
    const fetcher = network(change);
    await expect(runAiTest(db.client, id, input, inspection.quote!, fetcher)).rejects.toThrow(/^ai_quote_changed$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
    expect(db.writes).toEqual([]);
  });

  it("keeps quotes stable across metadata refresh times but invalidates changed setup settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T10:00:00Z"));
    const db = fixture(); const fetcher = network();
    const before = await inspectAiProfile(db.client, input, fetcher);
    vi.setSystemTime(new Date("2026-10-02T10:01:00Z"));
    const after = await inspectAiProfile(db.client, input, fetcher);
    expect(after.metadata.fetchedAt).not.toBe(before.metadata.fetchedAt);
    expect(after.quote).toBe(before.quote);
    await expect(runAiTest(db.client, id, { ...input, maxOutputTokens: 512 }, before.quote!, fetcher)).rejects.toThrow(/^ai_quote_changed$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it.each([
    { supported_parameters: ["max_tokens", "reasoning"] },
    { supported_parameters: ["response_format", "structured_outputs"] },
    { context_length: 1000 },
    { context_length: null },
    { max_prompt_tokens: 1000 },
    { max_completion_tokens: 256 },
    { pricing: { prompt: "0", completion: null } },
    { pricing: { prompt: "0", completion: "0", request: "0.001" } },
    { status: 1 },
  ])("never treats model-wide metadata as proof an incompatible endpoint works: %j", async (change) => {
    const db = fixture(); const fetcher = network({ endpoints: [{ model_id: input.modelId, provider_name: "Fixture provider", tag: "fixture/fp8",
      status: 0, context_length: 65_536, max_completion_tokens: 8192, supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"],
      pricing: { prompt: "0.00000001", completion: "0.00000002" }, ...change }] });
    const inspection = await inspectAiProfile(db.client, input, fetcher);
    expect(inspection).toMatchObject({ compatible: false, quote: null, testCeilingUsd: null });
    await expect(runAiTest(db.client, id, input, "0".repeat(64), fetcher)).rejects.toThrow(/^no_compatible_endpoint$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it("requires a fresh quote when the previously inspected provider disappears", async () => {
    const db = fixture();
    const inspection = await inspectAiProfile(db.client, input, network());
    const fetcher = network({ endpoints: [{ model_id: input.modelId, provider_name: "Other provider", tag: "other",
      status: 0, context_length: 65_536, max_completion_tokens: 8192, supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"],
      pricing: { prompt: "0.00000001", completion: "0.00000002" } }] });
    await expect(runAiTest(db.client, id, input, inspection.quote!, fetcher)).rejects.toThrow(/^no_compatible_endpoint$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it.each([{ promptPrice: "0.001", completionPrice: "0.001" }, { requestUsd: 0.000001 }])(
    "rejects a test above the one-cent or owner request ceiling before reserving or dispatching", async (options) => {
      const db = fixture(options); const fetcher = network(options);
      await expect(runQuotedTest(db.client, id, input, fetcher)).rejects.toThrow(/^test_exceeds_limit$/);
      expect(db.rpc).not.toHaveBeenCalled();
      expect(dispatches(fetcher)).toHaveLength(0);
      expect(db.writes).toEqual([]);
    });

  it("does not dispatch on a replayed reservation acknowledgement", async () => {
    const db = fixture({ duplicate: true }); const fetcher = network();
    await expect(runQuotedTest(db.client, id, input, fetcher)).rejects.toThrow(/^test_already_started$/);
    expect(dispatches(fetcher)).toHaveLength(0);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.writes).toEqual([]);
  });

  it.each([
    { input_cache_write: "0.000001" },
    { overrides: [{ context_length: 1000, prompt: "0.001" }] },
  ])("rejects freshly reported unsupported billing before reservation", async (extraPricing) => {
    const db = fixture(); const fetcher = network({ extraPricing });
    await expect(runQuotedTest(db.client, id, input, fetcher)).rejects.toThrow(/^no_compatible_endpoint$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it.each([
    () => Response.json({ choices: [{ message: { content: JSON.stringify(validCases) } }] }),
    () => { throw new Error("PRIVATE_TRANSPORT_DETAIL"); },
    () => new Response("x".repeat(128_001)),
  ])("holds the reservation when cost is uncertain and never invents a refund", async (response) => {
    const db = fixture(); const fetcher = network({ response });
    const result = await runQuotedTest(db.client, id, input, fetcher);
    expect(result).toMatchObject({ passed: false, costState: "unknown", costUsd: null });
    expect(result.reservedUsd).toBeGreaterThan(0);
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "unknown", p_usd: null });
    expect(dispatches(fetcher)).toHaveLength(6);
    expect(JSON.stringify(db.writes)).not.toContain("PRIVATE_TRANSPORT_DETAIL");
  });

  it("supports an actually free model with zero price limits and verified zero usage", async () => {
    const db = fixture(); const fetcher = network({ promptPrice: "0", completionPrice: "0",
      response: (_init, index) => responseForCase(index, 0) });
    const result = await runQuotedTest(db.client, id, input, fetcher);
    expect(result).toMatchObject({ passed: true, reservedUsd: 0, costUsd: 0, costState: "verified" });
    expect(db.rpc).toHaveBeenCalledWith("ai_test_reserve", { p_id: id, p_usd: 0 });
    expect(JSON.parse(String(dispatches(fetcher)[0][1]?.body)).provider.max_price).toEqual({ prompt: 0, completion: 0, request: 0, image: 0 });
  });

  it("records an unexpected charge, fails the test, and never clamps it to the reservation", async () => {
    const db = fixture(); const fetcher = network({ response: () => Response.json({ usage: { cost: 0.02 },
      choices: [{ message: { content: JSON.stringify(validCases) } }] }) });
    const result = await runQuotedTest(db.client, id, input, fetcher);
    expect(result).toMatchObject({ passed: false, outcome: "cost_exceeded", costUsd: 0.12 });
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "verified", p_usd: 0.12 });
  });

  it("stores a failed receipt with per-case cost evidence if settlement acknowledgement fails", async () => {
    const db = fixture({ settlementError: true });
    const result = await runQuotedTest(db.client, id, input, network());
    expect(result).toMatchObject({ passed: false, outcome: "accounting_unconfirmed", costState: "unknown", costUsd: null });
    expect(result.cases.every((item) => item.attempt?.costUsd === 0.00001)).toBe(true);
    expect(db.writes).toHaveLength(1);
  });

  it("retains uncertain cost after the provider request deadline and does not retry", async () => {
    vi.useFakeTimers();
    const db = fixture();
    const fetcher = network({ response: (init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT_DETAIL")), { once: true });
    }) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result).toMatchObject({ passed: false, outcome: "timeout", costState: "unknown", costUsd: null });
    expect(result.reservedUsd).toBeGreaterThan(0);
    expect(dispatches(fetcher)).toHaveLength(6);
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "unknown", p_usd: null });
  });

  it("reports receipt storage failure after preserving the settled charge", async () => {
    const db = fixture({ insertError: true });
    await expect(runQuotedTest(db.client, id, input, network())).rejects.toThrow(/^test_receipt_unavailable$/);
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "verified", p_usd: 0.00006 });
  });

  it("preserves validated cases and their verified charges when concurrent cases time out", async () => {
    vi.useFakeTimers();
    const db = fixture();
    const fetcher = network({ response: (_init, index) => index < 4 ? responseForCase(index) : new Promise<Response>(() => {}) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result).toMatchObject({ passed: false, outcome: "timeout", costState: "unknown", costUsd: null });
    expect(result.cases.map((item) => item.passed)).toEqual([true, true, true, true, false, false]);
    expect(result.cases.slice(0, 4).every((item) => item.attempt?.costUsd === 0.00001)).toBe(true);
    expect(result.cases.slice(4).every((item) => item.attempt?.costState === "unknown")).toBe(true);
    expect(db.writes[0].row).toMatchObject({ result: { cases: result.cases, reservedUsd: result.reservedUsd } });
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "unknown", p_usd: null });
    expect(dispatches(fetcher)).toHaveLength(6);
    expect(dispatches(fetcher).slice(4).every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it("bounds six stalled requests even when the transport ignores cancellation", async () => {
    vi.useFakeTimers();
    const db = fixture(); const fetcher = network({ response: () => new Promise<Response>(() => {}) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result.cases).toHaveLength(6);
    expect(result.cases.every((item) => item.attempt?.outcome === "timeout" && item.attempt.timings.totalMs === 20_000)).toBe(true);
    expect(dispatches(fetcher).every(([, init]) => init?.signal?.aborted)).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps finalization independent of client cancellation and retains completed case costs", async () => {
    vi.useFakeTimers(); const caller = new AbortController(); const db = fixture();
    const fetcher = network({ response: (init, index) => index === 0 ? responseForCase(index) : new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_ABORT")), { once: true });
    }) });
    const quote = (await inspectAiProfile(db.client, input, fetcher)).quote!;
    const pending = runAiTest(db.client, id, input, quote, fetcher, { startedAtMs: Date.now(), signal: caller.signal });
    await vi.advanceTimersByTimeAsync(5000); caller.abort();
    const result = await pending;
    expect(result.cases[0]).toMatchObject({ passed: true, attempt: { costState: "verified", costUsd: 0.00001 } });
    expect(result.cases.slice(1).every((item) => item.attempt?.outcome === "timeout")).toBe(true);
    expect(result.costState).toBe("unknown"); expect(db.writes).toHaveLength(1);
    expect(db.signals.at(-1)?.aborted).toBe(false);
  });

  it("ignores late provider success after recording concurrent timeouts", async () => {
    vi.useFakeTimers(); const db = fixture();
    const fetcher = network({ response: (_init, index) => new Promise<Response>((resolve) => setTimeout(() => resolve(responseForCase(index)), 30_000)) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending; const saved = JSON.stringify(db.writes);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(JSON.stringify(db.writes)).toBe(saved);
    expect(result.cases.every((item) => item.attempt?.outcome === "timeout" && item.attempt.timings.headersAfterMs === null)).toBe(true);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it("distinguishes slow headers from body reading and validates before persisting verified costs", async () => {
    vi.useFakeTimers();
    const db = fixture();
    const fetcher = network({ response: (_init, index) => new Promise<Response>((resolve) => setTimeout(() => {
      const bytes = new TextEncoder().encode(JSON.stringify({ usage: { cost: 0.00001 }, choices: [{ message: { content: JSON.stringify(Object.values(validCases)[index]) } }] }));
      resolve(new Response(new ReadableStream({ start(controller) { setTimeout(() => { controller.enqueue(bytes); controller.close(); }, 1000); } })));
    }, 18_000)) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(19_000);
    const result = await pending;
    expect(result).toMatchObject({ passed: true, costUsd: 0.00006, timings: { requestsMs: 19_000, settlement: "acknowledged" } });
    for (const item of result.cases) expect(item.attempt?.timings).toEqual({ headersAfterMs: 18_000, bodyAfterMs: 19_000, validationMs: 0, totalMs: 19_000, httpStatus: 200 });
  });

  it("cancels incomplete bodies without inventing a cost or validation result", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn(); const db = fixture();
    const fetcher = network({ response: () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"usage":{"cost":0.00001},"PRIVATE_PARTIAL":')); }, cancel: cancelled,
    })) });
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(cancelled).toHaveBeenCalledTimes(6);
    for (const item of result.cases) expect(item.attempt).toMatchObject({ outcome: "timeout", costState: "unknown", costUsd: null,
      timings: { headersAfterMs: 0, bodyAfterMs: null, validationMs: null } });
    expect(JSON.stringify(db.writes)).not.toContain("PRIVATE_PARTIAL");
  });

  it("does not discard other cases when one complete response is malformed", async () => {
    const db = fixture(); const fetcher = network({ response: (_init, index) => index === 2 ? new Response("{PRIVATE_BROKEN") : responseForCase(index) });
    const result = await runQuotedTest(db.client, id, input, fetcher);
    expect(result.cases.map((item) => item.passed)).toEqual([true, true, false, true, true, true]);
    expect(result.cases[2].attempt).toMatchObject({ outcome: "invalid_response", timings: { bodyAfterMs: expect.any(Number), validationMs: null } });
    expect(result.costState).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BROKEN");
  });

  it.each([
    [{ error: { message: "No endpoints found that match your requirements" } }, "verified", 0],
    [{ id: "gen-private", error: { message: "No endpoints found that match your requirements" } }, "unknown", null],
    [{ error: { message: "PRIVATE_UNRECOGNIZED_404" } }, "unknown", null],
  ])("only treats recognized refusals without generation IDs as verified free (%j)", async (body, costState, costUsd) => {
    const db = fixture(); const result = await runQuotedTest(db.client, id, input, network({ response: () => Response.json(body, { status: 404 }) }));
    expect(result).toMatchObject({ passed: false, costState, costUsd });
    expect(JSON.stringify(result)).not.toMatch(/gen-private|PRIVATE_UNRECOGNIZED/);
  });

  it("refuses dispatch when the database rejects the aggregate monthly reservation", async () => {
    const db = fixture({ spendingBlocked: true }); const fetcher = network();
    await expect(runQuotedTest(db.client, id, input, fetcher)).rejects.toThrow("ai_spending_blocked");
    expect(dispatches(fetcher)).toHaveLength(0);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch or reserve after a late configuration read outlives preflight", async () => {
    vi.useFakeTimers();
    const db = fixture({ configurationDelayMs: 30_000 }); const fetcher = network();
    const pending = runQuotedTest(db.client, id, input, fetcher);
    const rejected = expect(pending).rejects.toThrow("qualification_deadline");
    await vi.advanceTimersByTimeAsync(25_000); await rejected;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it("keeps a late reservation acknowledgement from authorizing dispatch", async () => {
    vi.useFakeTimers();
    const db = fixture({ reservationDelayMs: 30_000 }); const fetcher = network();
    const pending = runQuotedTest(db.client, id, input, fetcher);
    const rejected = expect(pending).rejects.toThrow("qualification_deadline");
    await vi.advanceTimersByTimeAsync(35_000); await rejected;
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["ai_test_reserve"]);
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it("includes metadata, requests, settlement and the receipt in the 60-second route budget", async () => {
    vi.useFakeTimers();
    const db = fixture({ configurationDelayMs: 1000, reservationDelayMs: 2000, settlementDelayMs: 8000, insertDelayMs: 2900 });
    const immediate = network({ response: (_init, index) => new Promise<Response>((resolve) => setTimeout(() => resolve(responseForCase(index)), 19_900)) });
    let delayMetadata = false;
    const fetcher: typeof fetch = async (url, init) => {
      if (delayMetadata && !String(url).endsWith("/chat/completions")) await new Promise((resolve) => setTimeout(resolve, 7000));
      return immediate(url, init);
    };
    const setup = { ...input, retention: "zdr" as const };
    const inspected = await inspectAiProfile(db.client, setup, fetcher);
    delayMetadata = true;
    const startedAt = Date.now();
    const pending = runAiTest(db.client, id, setup, inspected.quote!, fetcher);
    await vi.advanceTimersByTimeAsync(54_800);
    const result = await pending;
    expect(result).toMatchObject({ passed: true, timings: { preflightMs: 24_000, metadataMs: 21_000,
      reservationMs: 2000, requestsMs: 19_900, settlementMs: 8000, receiptStartedAfterMs: 51_900 } });
    expect(Date.now() - startedAt).toBe(54_800);
    expect(db.writes).toHaveLength(1);
  });

  it("preserves case evidence and receipt time when settlement stalls", async () => {
    vi.useFakeTimers();
    const db = fixture({ settlementDelayMs: 90_000, insertDelayMs: 2500 }); const fetcher = network();
    const pending = runQuotedTest(db.client, id, input, fetcher);
    await vi.advanceTimersByTimeAsync(57_500);
    const result = await pending;
    expect(result).toMatchObject({ passed: false, outcome: "accounting_unconfirmed", costState: "unknown", timings: { settlement: "unconfirmed", receiptStartedAfterMs: 55_000 } });
    expect(result.cases.every((item) => item.attempt?.costUsd === 0.00001)).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(db.signals.some((signal) => signal.aborted)).toBe(true);
  });

  it("bounds receipt persistence and preserves settled charges if its acknowledgement is lost", async () => {
    vi.useFakeTimers();
    const db = fixture({ insertDelayMs: 90_000 });
    const pending = runQuotedTest(db.client, id, input, network());
    const rejected = expect(pending).rejects.toThrow("test_receipt_unavailable");
    await vi.advanceTimersByTimeAsync(58_000); await rejected;
    expect(db.rpc).toHaveBeenLastCalledWith("ai_test_settle", { p_id: id, p_state: "verified", p_usd: 0.00006 });
    expect(db.writes).toHaveLength(1);
    expect(db.signals.at(-1)?.aborted).toBe(true);
  });

  it("fails closed when the profile cannot fit the test within its advertised context", async () => {
    const db = fixture(); const fetcher = network({ context: 1000 });
    await expect(runQuotedTest(db.client, id, input, fetcher)).rejects.toThrow(/^no_compatible_endpoint$/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(dispatches(fetcher)).toHaveLength(0);
  });

  it("marks individual failed or injection-following decisions without publishing or retaining raw text", () => {
    const wrong = { ...validCases, injection: { ...extraction, clusterSlug: "travel-crash" }, broad: validCases.exact };
    const cases = Object.entries(wrong).map(([key, value]) => evaluateAiTestCase(key, JSON.stringify(value)));
    expect(cases.map((item) => item.passed)).toEqual([true, true, false, true, false, true]);
    expect(JSON.stringify(cases)).not.toContain(sourceMarker);
    expect(Object.keys(wrong).every((key) => !evaluateAiTestCase(key, "{}").passed)).toBe(true);
  });
});
