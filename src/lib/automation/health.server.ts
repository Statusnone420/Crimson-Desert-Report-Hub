import "server-only";
import { createServiceClient } from "@/lib/supabase";
import { SCANNER_AI_RELEVANT_SKIP_CODES, scannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";
import { automationBudgetUsd } from "@/lib/env";

const RELEVANT_AI_RUN_FILTER = [
  "progress->>llmSucceeded.gt.0",
  ...SCANNER_AI_RELEVANT_SKIP_CODES.map((code) => `skips.cs.["${code}"]`),
].join(",");

const AI_RUN_FIELDS = "started_at, finished_at, status, mode, skips, llm_calls_used, progress";

export async function getScannerAiHealth(options: { paused?: boolean; monthlyLlmUsdCap?: number } = {}) {
  try {
    const client = createServiceClient();
    const completedQuery = () => client.from("automation_runs").select(AI_RUN_FIELDS)
      .neq("status", "skipped").neq("status", "running").neq("mode", "dry_run");
    const meaningfulFinishedResult = completedQuery()
      .or(RELEVANT_AI_RUN_FILTER)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1);
    const meaningfulLegacyResult = completedQuery()
      .or(RELEVANT_AI_RUN_FILTER)
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
    const environmentCap = automationBudgetUsd();
    const effectiveOptions = {
      ...options,
      monthlyLlmUsdCap: Math.min(options.monthlyLlmUsdCap ?? environmentCap, environmentCap),
    };
    return scannerAiHealth(runs, effectiveOptions);
  } catch {
    return scannerAiHealth([], { readAvailable: false });
  }
}
