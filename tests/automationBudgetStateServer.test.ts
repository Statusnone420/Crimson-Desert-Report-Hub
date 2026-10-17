import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadMonthSpend,
  readCurrentScannerBudgetCapped,
} from "@/lib/automation/budgetState.server";
import type { ScannerPolicy } from "@/lib/automation/settings";
const aiConfiguration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/aiSettings/store.server", () => ({ readAiConfiguration: aiConfiguration }));

type SpendRow = {
  estimated_cost_usd?: number;
  search_queries_used?: number;
  skips?: string[];
  started_at: string;
};

function spendReader(rows: SpendRow[] | null, error: { message: string } | null = null) {
  const query = {
    select: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: rows, error });
  return {
    from: vi.fn(() => query),
    rpc: vi.fn<() => Promise<{ data: unknown; error: { code: string; message: string } | null }>>(async () =>
      ({ data: null, error: { code: "PGRST202", message: "Could not find public.scanner_budget_summary" } })),
    query,
  };
}

function policy(overrides: Partial<ScannerPolicy> = {}): ScannerPolicy {
  return {
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 1000,
    monthlyLlmUsdCap: 1,
    modelPreset: "gpt_5_6_luna",
    ...overrides,
  };
}

function asServiceClient(reader: ReturnType<typeof spendReader>) {
  return reader as unknown as Parameters<typeof loadMonthSpend>[0];
}

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { aiConfiguration.mockReset().mockResolvedValue(null); });

describe("current scanner budget cap", () => {
  it("uses the activated AI allowance even when the legacy environment allowance is exhausted", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0.5");
    aiConfiguration.mockResolvedValue({ active: { modelId: "fixture/active" }, policy: { monthlyUsd: 50 } });
    const reader = spendReader([]);
    reader.rpc.mockResolvedValue({ data: { accountingVersion: 1, estimatedCostUsd: 2, tavilyCredits: 0, llmCostUsd: 2, openRouterCircuitOpen: false }, error: null });
    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy(), new Date())).toBe(false);
    aiConfiguration.mockResolvedValue({ active: { modelId: "fixture/active" }, policy: { monthlyUsd: 2 } });
    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy(), new Date())).toBe(true);
  });
  it("surfaces configuration read errors instead of reporting an available legacy allowance", async () => {
    aiConfiguration.mockRejectedValue(new Error("ai_settings_unavailable"));
    await expect(readCurrentScannerBudgetCapped(asServiceClient(spendReader([])), policy(), new Date())).rejects.toThrow("ai_settings_unavailable");
  });
  it("uses authoritative totals without querying run projections", async () => {
    const reader = spendReader([]);
    reader.rpc.mockResolvedValue({ data: { accountingVersion: 1, estimatedCostUsd: "0.027", tavilyCredits: 3,
      llmCostUsd: "0.003", openRouterCircuitOpen: false }, error: null });
    expect(await loadMonthSpend(asServiceClient(reader), new Date())).toEqual({ estimatedCostUsd: 0.027,
      tavilyCredits: 3, llmCostUsd: 0.003, openRouterCircuitOpen: false, monthlyAiPause: false });
    expect(reader.from).not.toHaveBeenCalled();
  });
  it.each([null, true, -1, "NaN", "", 0.5])("rejects invalid authoritative credit totals: %j", async (tavilyCredits) => {
    const reader = spendReader([]);
    reader.rpc.mockResolvedValue({ data: { accountingVersion: 1, estimatedCostUsd: 0, tavilyCredits,
      llmCostUsd: 0, openRouterCircuitOpen: false }, error: null });
    await expect(loadMonthSpend(asServiceClient(reader), new Date())).rejects.toThrow("acknowledgment invalid");
    expect(reader.from).not.toHaveBeenCalled();
  });
  it("does not hide a permission failure behind legacy totals", async () => {
    const reader = spendReader([]);
    reader.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(loadMonthSpend(asServiceClient(reader), new Date())).rejects.toMatchObject({ code: "42501" });
    expect(reader.from).not.toHaveBeenCalled();
  });
  it("reads legacy totals past the 1,000-row API page limit with stable ordering", async () => {
    const reader = spendReader([]);
    const row = { started_at: "2026-09-10T12:00:00Z", estimated_cost_usd: 0.008, search_queries_used: 1 };
    reader.query.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row), error: null })
      .mockResolvedValueOnce({ data: [row], error: null });
    expect((await loadMonthSpend(asServiceClient(reader), new Date("2026-09-11T12:00:00Z"))).tavilyCredits).toBe(1001);
    expect(reader.query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(reader.query.order.mock.calls).toEqual([["started_at"], ["id"], ["started_at"], ["id"]]);
  });
  it("reads from the UTC month start and excludes previous-month spend after rollover", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const now = new Date("2026-09-01T12:00:00.000Z");
    const reader = spendReader([
      { started_at: "2026-08-31T13:00:00.000Z", search_queries_used: 1 },
    ]);

    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy({ monthlyTavilyCreditCap: 1 }), now)).toBe(false);
    expect(reader.query.select).toHaveBeenCalledWith("estimated_cost_usd, search_queries_used, skips, started_at");
    expect(reader.query.gte).toHaveBeenCalledWith("started_at", "2026-09-01T00:00:00.000Z");
  });

  it("reflects lowered and raised saved LLM limits against the same current-month usage", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const now = new Date("2026-09-11T12:00:00.000Z");
    const rows = [{ started_at: "2026-09-10T12:00:00.000Z", estimated_cost_usd: 0.1 }];

    expect(await readCurrentScannerBudgetCapped(asServiceClient(spendReader(rows)), policy({ monthlyLlmUsdCap: 0.05 }), now)).toBe(true);
    expect(await readCurrentScannerBudgetCapped(asServiceClient(spendReader(rows)), policy({ monthlyLlmUsdCap: 0.25 }), now)).toBe(false);
  });

  it("reports a current Tavily cap without a historical cap marker", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const reader = spendReader([{ started_at: "2026-09-10T12:00:00.000Z", search_queries_used: 1, skips: [] }]);

    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy({ monthlyTavilyCreditCap: 1 }), new Date("2026-09-11T12:00:00.000Z"))).toBe(true);
  });

  it("reports an explicitly configured zero LLM limit", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");

    expect(await readCurrentScannerBudgetCapped(asServiceClient(spendReader([])), policy({ monthlyLlmUsdCap: 0 }), new Date("2026-09-11T12:00:00.000Z"))).toBe(true);
  });

  it("uses the environment LLM ceiling", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0.1");
    const reader = spendReader([{ started_at: "2026-09-10T12:00:00.000Z", estimated_cost_usd: 0.1 }]);

    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy({ monthlyLlmUsdCap: 1 }), new Date("2026-09-11T12:00:00.000Z"))).toBe(true);
  });

  it("rejects a failed spend read instead of returning a clear badge", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const reader = spendReader(null, { message: "ledger unavailable" });

    await expect(readCurrentScannerBudgetCapped(asServiceClient(reader), policy(), new Date("2026-09-11T12:00:00.000Z"))).rejects.toThrow(
      "automation spend read failed: ledger unavailable",
    );
  });

  it("keeps circuit state separate from the budget badge", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const now = new Date("2026-09-11T12:00:00.000Z");
    const rows = [{ started_at: "2026-09-10T12:00:00.000Z", skips: ["openrouter_budget_exceeded"] }];

    expect((await loadMonthSpend(asServiceClient(spendReader(rows)), now)).openRouterCircuitOpen).toBe(true);
    expect(await readCurrentScannerBudgetCapped(asServiceClient(spendReader(rows)), policy(), now)).toBe(false);
  });
});
