import "server-only";
import { createServiceClient } from "@/lib/supabase";
import { scannerAiHealth, type ScannerAiRun } from "@/lib/automation/health";

export async function getScannerAiHealth(options: { paused?: boolean; monthlyLlmUsdCap?: number } = {}) {
  try {
    const { data, error } = await createServiceClient()
      .from("automation_runs")
      .select("started_at, finished_at, status, mode, skips, llm_calls_used, progress")
      .neq("status", "skipped")
      .neq("status", "running")
      .neq("mode", "dry_run")
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) return scannerAiHealth([], { readAvailable: false });
    return scannerAiHealth((data ?? []) as ScannerAiRun[], options);
  } catch {
    return scannerAiHealth([], { readAvailable: false });
  }
}
