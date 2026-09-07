import "server-only";
import { createServiceClient } from "@/lib/supabase";
import { SCANNER_AI_RELEVANT_SKIP_CODES, scannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";

const RELEVANT_AI_RUN_FILTER = [
  "progress->>llmSucceeded.gt.0",
  ...SCANNER_AI_RELEVANT_SKIP_CODES.map((code) => `skips.cs.["${code}"]`),
].join(",");

const AI_RUN_FIELDS = "started_at, finished_at, status, mode, skips, llm_calls_used, progress";

export async function getScannerAiHealth(options: { paused?: boolean; monthlyLlmUsdCap?: number } = {}) {
  try {
    const client = createServiceClient();
    const meaningfulResult = client
      .from("automation_runs")
      .select(AI_RUN_FIELDS)
      .neq("status", "skipped")
      .neq("status", "running")
      .neq("mode", "dry_run")
      .or(RELEVANT_AI_RUN_FILTER)
      .order("started_at", { ascending: false })
      .limit(1);
    const validatedResult = client
      .from("automation_runs")
      .select(AI_RUN_FIELDS)
      .neq("status", "skipped")
      .neq("status", "running")
      .neq("mode", "dry_run")
      .gt("progress->>llmSucceeded", 0)
      .order("started_at", { ascending: false })
      .limit(1);
    const [meaningful, validated] = await Promise.all([meaningfulResult, validatedResult]);
    if (meaningful.error || validated.error) return scannerAiHealth([], { readAvailable: false });
    return scannerAiHealth([...(meaningful.data ?? []), ...(validated.data ?? [])] as ScannerAiRun[], options);
  } catch {
    return scannerAiHealth([], { readAvailable: false });
  }
}
