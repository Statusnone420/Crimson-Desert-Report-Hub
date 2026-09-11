import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadMonthSpend,
  readCurrentScannerBudgetCapped,
} from "@/lib/automation/budgetState.server";
import type { ScannerPolicy } from "@/lib/automation/settings";

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
  };
  query.select.mockReturnValue(query);
  query.gte.mockResolvedValue({ data: rows, error });
  return {
    from: vi.fn(() => query),
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

describe("current scanner budget cap", () => {
  it("keeps the rolling circuit read but excludes previous-month spend after UTC rollover", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "1");
    const now = new Date("2026-09-01T12:00:00.000Z");
    const reader = spendReader([
      { started_at: "2026-08-31T13:00:00.000Z", search_queries_used: 1 },
    ]);

    expect(await readCurrentScannerBudgetCapped(asServiceClient(reader), policy({ monthlyTavilyCreditCap: 1 }), now)).toBe(false);
    expect(reader.query.select).toHaveBeenCalledWith("estimated_cost_usd, search_queries_used, skips, started_at");
    expect(reader.query.gte).toHaveBeenCalledWith("started_at", "2026-08-31T12:00:00.000Z");
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
