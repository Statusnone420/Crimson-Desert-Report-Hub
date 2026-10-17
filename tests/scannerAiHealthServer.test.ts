import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_AI_RELEVANT_SKIP_CODES, type ScannerAiRun } from "@/lib/automation/health";

const mocks = vi.hoisted(() => ({ aiConfiguration: vi.fn(), from: vi.fn(), rpc: vi.fn<(name: string) => Promise<{ data: unknown;
  error: { code: string; message: string } | null }>>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/aiSettings/store.server", () => ({ readAiConfiguration: mocks.aiConfiguration }));

import { getScannerAiHealth } from "@/lib/automation/health.server";

function queryResult(data: unknown[] | null, error: unknown = null) {
  const projected = data?.map((row) => {
    const value = row as ScannerAiRun;
    return value.progress ? { ...value, llmSucceeded: value.progress.llmSucceeded, openRouterTrace: value.progress.openRouterTrace } : value;
  }) ?? data;
  const query = {
    select: vi.fn(),
    neq: vi.fn(),
    or: vi.fn(),
    gt: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gte: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: projected, error });
  query.gte.mockReturnValue(query);
  query.range.mockResolvedValue({ data: projected, error });
  return query;
}

const run = (overrides: Partial<ScannerAiRun> = {}): ScannerAiRun => ({
  started_at: "2026-09-06T20:00:00Z",
  status: "success",
  mode: "scheduled",
  skips: [],
  llm_calls_used: 1,
  progress: { llmSucceeded: 1 },
  ...overrides,
});

describe("scanner AI health history query", () => {
  it.each([false, true])("retains unknown-cost history with current circuit=%s", async (openRouterCircuitOpen) => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "scanner_budget_summary" ?
      { accountingVersion: 1, estimatedCostUsd: 0.01, tavilyCredits: 0, llmCostUsd: 0.01, openRouterCircuitOpen } :
      [run({ status: "partial", skips: ["openrouter_cost_unverified"], progress: { llmSucceeded: 0 } })], error: null }));
    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 1 })).toMatchObject({
      state: "unavailable", code: "openrouter_cost_unverified",
      currentSpending: openRouterCircuitOpen ? "blocked" : "within_limits",
    });
  });
  it.each([
    { paidSpendingAnomaly: true, reconciliationRequired: false, expected: "month_paused" },
    { paidSpendingAnomaly: true, reconciliationRequired: true, expected: "blocked" },
    { paidSpendingAnomaly: false, reconciliationRequired: true, expected: "blocked" },
  ])("does not conflate a current month anomaly with unresolved legacy debt: $expected", async ({ expected, ...flags }) => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "scanner_budget_summary" ?
      { accountingVersion: 1, estimatedCostUsd: 0.01, tavilyCredits: 0, llmCostUsd: 0.01, openRouterCircuitOpen: true, ...flags } :
      [run({ status: "partial", skips: ["openrouter_cost_unverified"], progress: { llmSucceeded: 0 } })], error: null }));
    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 1 })).toMatchObject({
      state: "unavailable", code: "openrouter_cost_unverified", currentSpending: expected,
    });
  });
  it.each([
    { paused: true, monthlyLlmUsdCap: 1, validated: false },
    { paused: true, monthlyLlmUsdCap: 1, validated: true },
    { paused: false, monthlyLlmUsdCap: 0, validated: false },
    { paused: false, monthlyLlmUsdCap: 0, validated: true },
  ])("preserves last AI result under policy pause=$paused allowance=$monthlyLlmUsdCap validated=$validated", async ({ validated, ...policy }) => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "scanner_budget_summary" ?
      { accountingVersion: 1, estimatedCostUsd: 0.01, tavilyCredits: 0, llmCostUsd: 0.01, openRouterCircuitOpen: false } :
      [run(validated ? {} : { status: "partial", skips: ["openrouter_cost_unverified"], progress: { llmSucceeded: 0 } })], error: null }));
    expect(await getScannerAiHealth(policy)).toMatchObject({
      state: "idle", code: policy.paused ? "scanner_paused" : "ai_disabled",
      lastScanResult: { state: validated ? "healthy" : "unavailable", code: validated ? null : "openrouter_cost_unverified" },
    });
  });
  beforeEach(() => {
    mocks.aiConfiguration.mockReset().mockResolvedValue(null);
    mocks.from.mockReset();
    mocks.rpc.mockReset().mockImplementation(async (name) => ({ data: null,
      error: { code: "PGRST202", message: `Could not find public.${name}` } }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("uses the managed allowance in the health filter after legacy allowance exhaustion", async () => {
    mocks.aiConfiguration.mockResolvedValue({ active: { modelId: "fixture/active" }, policy: { monthlyUsd: 50 } });
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0.5");
    mocks.rpc.mockImplementation(async (name) => ({ data: name === "scanner_budget_summary" ?
      { accountingVersion: 1, estimatedCostUsd: 2, tavilyCredits: 0, llmCostUsd: 2, openRouterCircuitOpen: false } :
      [run()], error: null }));
    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 0.5 })).toMatchObject({ state: "healthy" });
    expect(mocks.rpc).toHaveBeenCalledWith("scanner_ai_health_runs", { p_relevant_codes: expect.not.arrayContaining(["llm_budget_capped"]) });
  });

  it("reports unavailable history when active AI configuration cannot be read", async () => {
    mocks.aiConfiguration.mockRejectedValue(new Error("ai_settings_unavailable"));
    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fetches finished and legacy candidates for meaningful results and validated successes", async () => {
    const spend = queryResult([]);
    const meaningfulFinished = queryResult([run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T22:00:00Z", skips: ["openrouter_no_route"], progress: { llmSucceeded: 0 } })]);
    const meaningfulLegacy = queryResult([run({ started_at: "2026-09-06T21:00:00Z", finished_at: null })]);
    const validatedFinished = queryResult([run({ finished_at: "2026-09-06T20:01:00Z" })]);
    const validatedLegacy = queryResult([]);
    mocks.from
      .mockReturnValueOnce(spend)
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(meaningfulLegacy)
      .mockReturnValueOnce(validatedFinished)
      .mockReturnValueOnce(validatedLegacy);

    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", lastSuccessAt: "2026-09-06T21:00:00Z" });
    expect(mocks.from).toHaveBeenCalledTimes(5);
    expect(spend.select).toHaveBeenCalledWith("estimated_cost_usd, search_queries_used, skips, started_at");
    expect(spend.gte).toHaveBeenCalledWith("started_at", expect.any(String));
    expect(meaningfulFinished.neq.mock.calls).toEqual([
      ["status", "skipped"],
      ["status", "running"],
      ["mode", "dry_run"],
    ]);
    expect(meaningfulFinished.or).toHaveBeenCalledWith([
      "progress->>llmSucceeded.gt.0",
      "progress->>aiCompletionUnverified.eq.true",
      ...SCANNER_AI_RELEVANT_SKIP_CODES
        .filter((code) => code !== "llm_budget_capped")
        .map((code) => `skips.cs.["${code}"]`),
    ].join(","));
    expect(meaningfulFinished.not).toHaveBeenCalledWith("finished_at", "is", null);
    expect(meaningfulFinished.order).toHaveBeenCalledWith("finished_at", { ascending: false });
    expect(meaningfulLegacy.is).toHaveBeenCalledWith("finished_at", null);
    expect(meaningfulLegacy.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(validatedFinished.gt).toHaveBeenCalledWith("progress->>llmSucceeded", 0);
    expect(validatedFinished.not).toHaveBeenCalledWith("finished_at", "is", null);
    expect(validatedFinished.order).toHaveBeenCalledWith("finished_at", { ascending: false });
    expect(validatedLegacy.is).toHaveBeenCalledWith("finished_at", null);
    expect(validatedLegacy.order).toHaveBeenCalledWith("started_at", { ascending: false });
    for (const query of [meaningfulFinished, meaningfulLegacy, validatedFinished, validatedLegacy]) {
      expect(query.limit).toHaveBeenCalledWith(1);
      expect(query.select).toHaveBeenCalledWith(expect.stringContaining("openRouterTrace:progress->openRouterTrace"));
      expect(query.select).not.toHaveBeenCalledWith(expect.stringMatching(/, progress$/));
    }
  });
  it("reads authoritative spending and four health candidates in two bounded RPCs", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { accountingVersion: 1, estimatedCostUsd: 0, tavilyCredits: 0,
      llmCostUsd: 0, openRouterCircuitOpen: false }, error: null }).mockResolvedValueOnce({ data: [run()], error: null });
    expect(await getScannerAiHealth()).toMatchObject({ state: "healthy" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["scanner_budget_summary", "scanner_ai_health_runs"]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not fall back to history queries when the new health RPC rejects access", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { accountingVersion: 1, estimatedCostUsd: 0, tavilyCredits: 0,
      llmCostUsd: 0, openRouterCircuitOpen: false }, error: null }).mockResolvedValueOnce({ data: null,
      error: { code: "42501", message: "permission denied" } });
    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed when any bounded history query cannot be read", async () => {
    mocks.from
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult(null, { message: "read failed" }))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([run()]))
      .mockReturnValueOnce(queryResult([]));
    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable", lastSuccessAt: null });
  });

  it("clamps raw saved controls with the environment budget ceiling", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0");
    mocks.from
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([run()]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 1 })).toMatchObject({ state: "idle", code: "ai_disabled" });
  });

  it("excludes a stale LLM cap after a saved limit increase and retains the older provider failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-11T12:00:00.000Z");
    const spend = queryResult([{ started_at: "2026-09-10T12:00:00.000Z", estimated_cost_usd: 0.1 }]);
    const meaningfulFinished = queryResult([run({
      started_at: "2026-09-11T11:00:00.000Z",
      finished_at: "2026-09-11T11:01:00.000Z",
      skips: ["openrouter_provider_failure"],
      progress: { llmSucceeded: 0 },
    })]);
    mocks.from
      .mockReturnValueOnce(spend)
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 0.25 })).toMatchObject({
      state: "unavailable",
      code: "openrouter_provider_failure",
    });
    expect(meaningfulFinished.or).toHaveBeenCalledWith(expect.not.stringContaining('skips.cs.["llm_budget_capped"]'));
  });

  it("does not carry a previous UTC month's LLM cap into the current month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-01T12:00:00.000Z");
    const spend = queryResult([{ started_at: "2026-08-31T13:00:00.000Z", estimated_cost_usd: 0.1 }]);
    const meaningfulFinished = queryResult([]);
    mocks.from
      .mockReturnValueOnce(spend)
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 0.05 })).toMatchObject({ state: "idle", code: null });
    expect(meaningfulFinished.or).toHaveBeenCalledWith(expect.not.stringContaining('skips.cs.["llm_budget_capped"]'));
  });

  it("does not treat a spent Tavily allowance as an LLM cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-11T12:00:00.000Z");
    const spend = queryResult([{ started_at: "2026-09-10T12:00:00.000Z", estimated_cost_usd: 0.008, search_queries_used: 1 }]);
    const meaningfulFinished = queryResult([]);
    mocks.from
      .mockReturnValueOnce(spend)
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyTavilyCreditCap: 1, monthlyLlmUsdCap: 1 })).toMatchObject({ state: "idle", code: null });
    expect(meaningfulFinished.or).toHaveBeenCalledWith(expect.not.stringContaining('skips.cs.["llm_budget_capped"]'));
  });

  it("keeps a current LLM cap in the meaningful-history filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-11T12:00:00.000Z");
    const spend = queryResult([{ started_at: "2026-09-10T12:00:00.000Z", estimated_cost_usd: 0.1 }]);
    const meaningfulFinished = queryResult([run({ skips: ["llm_budget_capped"], progress: { llmSucceeded: 0 } })]);
    mocks.from
      .mockReturnValueOnce(spend)
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 0.05 })).toMatchObject({ state: "limited", code: "llm_budget_capped" });
    expect(meaningfulFinished.or).toHaveBeenCalledWith(expect.stringContaining('skips.cs.["llm_budget_capped"]'));
  });

  it("fails closed when the current month spend cannot be read", async () => {
    mocks.from.mockReturnValueOnce(queryResult(null, { message: "spend ledger unavailable" }));

    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable", lastSuccessAt: null });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
