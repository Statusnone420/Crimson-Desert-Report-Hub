import "server-only";

import { computeAutomationBudget, SEARCH_QUERY_COST_USD } from "@/lib/automation/budget";
import { circuitReadStartIso, openRouterCircuitOpenFromRuns } from "@/lib/automation/circuit";
import type { ScannerPolicy } from "@/lib/automation/settings";
import { automationBudgetUsd } from "@/lib/env";
import type { createServiceClient } from "@/lib/supabase";

export function applyAutomationBudgetCeiling(scannerPolicy: ScannerPolicy): ScannerPolicy {
  return {
    ...scannerPolicy,
    monthlyLlmUsdCap: Math.min(scannerPolicy.monthlyLlmUsdCap, automationBudgetUsd()),
  };
}

export async function loadMonthSpend(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<{ estimatedCostUsd: number; tavilyCredits: number; llmCostUsd: number; openRouterCircuitOpen: boolean }> {
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // circuitReadStartIso reaches into the previous month during a month's first
  // 24h (rolling blip window); spend accounting stays month-scoped below.
  const { data, error } = await supabase
    .from("automation_runs")
    .select("estimated_cost_usd, search_queries_used, skips, started_at")
    .gte("started_at", circuitReadStartIso(now));
  if (error) throw new Error(`automation spend read failed: ${error.message}`);
  const rows = (data ?? []) as {
    estimated_cost_usd?: number | string | null;
    search_queries_used?: number | string | null;
    skips?: unknown;
    started_at?: string | null;
  }[];
  const monthRows = rows.filter(
    (row) => typeof row.started_at === "string" && new Date(row.started_at).getTime() >= monthStartMs,
  );
  const usage = monthRows.reduce(
    (sum, row) => ({
      estimatedCostUsd: sum.estimatedCostUsd + Number(row.estimated_cost_usd ?? 0),
      tavilyCredits: sum.tavilyCredits + Number(row.search_queries_used ?? 0),
    }),
    { estimatedCostUsd: 0, tavilyCredits: 0 },
  );
  return {
    ...usage,
    llmCostUsd: Math.max(0, usage.estimatedCostUsd - usage.tavilyCredits * SEARCH_QUERY_COST_USD),
    openRouterCircuitOpen: openRouterCircuitOpenFromRuns(rows, now),
  };
}

export async function readCurrentScannerBudgetCapped(
  supabase: ReturnType<typeof createServiceClient>,
  scannerPolicy: ScannerPolicy,
  now: Date,
): Promise<boolean> {
  const effectivePolicy = applyAutomationBudgetCeiling(scannerPolicy);
  const monthSpend = await loadMonthSpend(supabase, now);
  const budget = computeAutomationBudget({
    monthlyBudgetUsd: effectivePolicy.monthlyLlmUsdCap,
    spentMonthToDateUsd: monthSpend.estimatedCostUsd,
    tavilyCreditsMonthToDate: monthSpend.tavilyCredits,
    llmSpentMonthToDateUsd: monthSpend.llmCostUsd,
    mode: "scheduled",
    now,
    scannerPolicy: effectivePolicy,
  });
  return budget.skipReasons.includes("tavily_credit_cap") || budget.skipReasons.includes("llm_budget_capped");
}
