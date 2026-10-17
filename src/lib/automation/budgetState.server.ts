import "server-only";

import { computeAutomationBudget, SEARCH_QUERY_COST_USD } from "@/lib/automation/budget";
import { circuitReadStartIso, openRouterCircuitOpenFromRuns } from "@/lib/automation/circuit";
import type { ScannerPolicy } from "@/lib/automation/settings";
import { automationBudgetUsd } from "@/lib/env";
import type { createServiceClient } from "@/lib/supabase";
import { missingScannerRpc } from "./accounting.server";
import { readAiConfiguration } from "@/lib/aiSettings/store.server";

export function applyAutomationBudgetCeiling(scannerPolicy: ScannerPolicy): ScannerPolicy {
  return {
    ...scannerPolicy,
    monthlyLlmUsdCap: scannerPolicy.aiManaged === true ? scannerPolicy.monthlyLlmUsdCap :
      Math.min(scannerPolicy.monthlyLlmUsdCap, automationBudgetUsd()),
  };
}

/** Admin readouts use the same saved allowance as the managed scanner. */
export async function readEffectiveScannerPolicy(
  supabase: ReturnType<typeof createServiceClient>, scannerPolicy: ScannerPolicy,
): Promise<ScannerPolicy> {
  const configuration = await readAiConfiguration(supabase);
  return configuration?.active ? { ...scannerPolicy, aiManaged: true, monthlyLlmUsdCap: configuration.policy.monthlyUsd } :
    applyAutomationBudgetCeiling(scannerPolicy);
}

export async function loadMonthSpend(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<{ estimatedCostUsd: number; tavilyCredits: number; llmCostUsd: number; openRouterCircuitOpen: boolean; monthlyAiPause?: boolean }> {
  const summary = await supabase.rpc("scanner_budget_summary", { p_now: now.toISOString() });
  if (!summary.error) {
    const value = summary.data as Record<string, unknown> | null;
    const amount = (number: unknown) => (typeof number === "number" || typeof number === "string" && /^[0-9]+(\.[0-9]+)?$/.test(number)) &&
      Number.isFinite(Number(number)) && Number(number) >= 0;
    if (!value || value.accountingVersion !== 1 || ![value.estimatedCostUsd, value.tavilyCredits, value.llmCostUsd]
      .every(amount) || !Number.isSafeInteger(Number(value.tavilyCredits)) || typeof value.openRouterCircuitOpen !== "boolean") {
      throw new Error("automation spend acknowledgment invalid");
    }
    return { estimatedCostUsd: Number(value.estimatedCostUsd), tavilyCredits: Number(value.tavilyCredits),
      llmCostUsd: Number(value.llmCostUsd), openRouterCircuitOpen: value.openRouterCircuitOpen,
      monthlyAiPause: value.paidSpendingAnomaly === true && value.reconciliationRequired === false };
  }
  if (!missingScannerRpc(summary.error, "scanner_budget_summary")) throw summary.error;
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // circuitReadStartIso reaches into the previous month during a month's first
  // 24h (rolling blip window); spend accounting stays month-scoped below.
  type SpendRow = {
    estimated_cost_usd?: number | string | null;
    search_queries_used?: number | string | null;
    skips?: unknown;
    started_at?: string | null;
  };
  const rows: SpendRow[] = [];
  // Stable pagination covers PostgREST's configured 1,000-row maximum.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("automation_runs")
      .select("estimated_cost_usd, search_queries_used, skips, started_at")
      .gte("started_at", circuitReadStartIso(now)).order("started_at").order("id").range(offset, offset + 999);
    if (error) throw new Error(`automation spend read failed: ${error.message}`);
    const page = (data ?? []) as SpendRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
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
  const effectivePolicy = await readEffectiveScannerPolicy(supabase, scannerPolicy);
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
