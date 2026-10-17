import "server-only";

import { computeAutomationBudget } from "@/lib/automation/budget";
import { readEffectiveScannerPolicy, loadMonthSpend } from "@/lib/automation/budgetState.server";
import { normalizeScannerPolicy, type ScannerPolicy } from "@/lib/automation/settings";
import { createServiceClient } from "@/lib/supabase";
import { scannerAiRelevantSkipCodes, scannerAiHealthWithResult as scannerAiHealth, type ScannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";
import { missingScannerRpc } from "./accounting.server";

function relevantAiRunFilter(llmBudgetCapped: boolean): string {
  return [
    "progress->>llmSucceeded.gt.0",
    "progress->>aiCompletionUnverified.eq.true",
    ...scannerAiRelevantSkipCodes(llmBudgetCapped).map((code) => `skips.cs.["${code}"]`),
  ].join(",");
}

const AI_RUN_FIELDS = "started_at, finished_at, status, mode, skips, llm_calls_used, llmSucceeded:progress->llmSucceeded, aiCompletionUnverified:progress->aiCompletionUnverified, openRouterTrace:progress->openRouterTrace";

export async function getScannerAiHealth(options: Partial<ScannerPolicy> = {}) {
  try {
    const client = createServiceClient();
    const now = new Date();
    const scannerPolicy = await readEffectiveScannerPolicy(client, normalizeScannerPolicy(options));
    const monthSpend = await loadMonthSpend(client, now);
    const budget = computeAutomationBudget({
      monthlyBudgetUsd: scannerPolicy.monthlyLlmUsdCap,
      spentMonthToDateUsd: monthSpend.estimatedCostUsd,
      tavilyCreditsMonthToDate: monthSpend.tavilyCredits,
      llmSpentMonthToDateUsd: monthSpend.llmCostUsd,
      mode: "scheduled",
      now,
      scannerPolicy,
    });
    const llmBudgetCapped = budget.skipReasons.includes("llm_budget_capped");
    const currentSpending: ScannerAiHealth["currentSpending"] = scannerPolicy.monthlyLlmUsdCap === 0 ? "disabled" :
      monthSpend.monthlyAiPause ? "month_paused" : llmBudgetCapped ? "month_limit" : monthSpend.openRouterCircuitOpen ? "blocked" : "within_limits";
    const withSpending = (health: ScannerAiHealth): ScannerAiHealth => ({ ...health, currentSpending });
    const summary = await client.rpc("scanner_ai_health_runs", { p_relevant_codes: scannerAiRelevantSkipCodes(llmBudgetCapped) });
    if (!summary.error) {
      if (!Array.isArray(summary.data) || summary.data.length > 4) throw new Error("Scanner health acknowledgment invalid");
      return withSpending(scannerAiHealth(summary.data as ScannerAiRun[], { paused: scannerPolicy.paused,
        monthlyLlmUsdCap: scannerPolicy.monthlyLlmUsdCap, llmBudgetCapped }));
    }
    if (!missingScannerRpc(summary.error, "scanner_ai_health_runs")) throw summary.error;
    const relevantFilter = relevantAiRunFilter(llmBudgetCapped);
    const completedQuery = () => client.from("automation_runs").select(AI_RUN_FIELDS)
      .neq("status", "skipped").neq("status", "running").neq("mode", "dry_run");
    const meaningfulFinishedResult = completedQuery()
      .or(relevantFilter)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);
    const meaningfulLegacyResult = completedQuery()
      .or(relevantFilter)
      .is("finished_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    const validatedFinishedResult = completedQuery()
      .gt("progress->>llmSucceeded", 0)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);
    const validatedLegacyResult = completedQuery()
      .gt("progress->>llmSucceeded", 0)
      .is("finished_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    const results = await Promise.all([
      meaningfulFinishedResult,
      meaningfulLegacyResult,
      validatedFinishedResult,
      validatedLegacyResult,
    ]);
    if (results.some((result) => result.error)) return withSpending(scannerAiHealth([], { readAvailable: false }));
    const runs = results.flatMap((result) => result.data ?? []).map((row) => {
      const value = row as ScannerAiRun & { llmSucceeded?: number; aiCompletionUnverified?: boolean; openRouterTrace?: unknown };
      return { ...value, progress: { llmSucceeded: value.llmSucceeded,
        openRouterTrace: value.openRouterTrace } };
    });
    return withSpending(scannerAiHealth(runs, {
      paused: scannerPolicy.paused,
      monthlyLlmUsdCap: scannerPolicy.monthlyLlmUsdCap,
      llmBudgetCapped,
    }));
  } catch {
    return { ...scannerAiHealth([], { readAvailable: false }), currentSpending: "unverified" as const };
  }
}
