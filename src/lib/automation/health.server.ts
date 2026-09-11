import "server-only";

import { computeAutomationBudget } from "@/lib/automation/budget";
import { applyAutomationBudgetCeiling, loadMonthSpend } from "@/lib/automation/budgetState.server";
import { normalizeScannerPolicy, type ScannerPolicy } from "@/lib/automation/settings";
import { createServiceClient } from "@/lib/supabase";
import { scannerAiRelevantSkipCodes, scannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";

function relevantAiRunFilter(llmBudgetCapped: boolean): string {
  return [
    "progress->>llmSucceeded.gt.0",
    ...scannerAiRelevantSkipCodes(llmBudgetCapped).map((code) => `skips.cs.["${code}"]`),
  ].join(",");
}

const AI_RUN_FIELDS = "started_at, finished_at, status, mode, skips, llm_calls_used, progress";

export async function getScannerAiHealth(options: Partial<ScannerPolicy> = {}) {
  try {
    const client = createServiceClient();
    const now = new Date();
    const scannerPolicy = applyAutomationBudgetCeiling(normalizeScannerPolicy(options));
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
    if (results.some((result) => result.error)) return scannerAiHealth([], { readAvailable: false });
    const runs = results.flatMap((result) => result.data ?? []) as ScannerAiRun[];
    return scannerAiHealth(runs, {
      paused: scannerPolicy.paused,
      monthlyLlmUsdCap: scannerPolicy.monthlyLlmUsdCap,
      llmBudgetCapped,
    });
  } catch {
    return scannerAiHealth([], { readAvailable: false });
  }
}
