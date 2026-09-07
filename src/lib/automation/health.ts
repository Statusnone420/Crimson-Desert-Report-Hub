export type ScannerAiHealth = {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
};

export type ScannerAiRun = {
  started_at: string;
  finished_at?: string | null;
  status: string;
  mode?: string;
  skips: string[];
  llm_calls_used: number;
  progress?: { llmSucceeded?: number; llmCostUsd?: number; modelPreset?: string | null } | null;
};

const FAILURE_MESSAGES: Record<string, string> = {
  openrouter_no_route: "No AI provider matches the selected route and price limit.",
  openrouter_missing_config: "The AI key is missing.",
  openrouter_paid_model: "The selected AI model is not approved.",
  openrouter_provider_failure: "The AI provider could not complete a request.",
  openrouter_invalid_json: "The AI response did not pass validation.",
  openrouter_unexpected_charge: "AI processing stopped after an unexpected charge.",
  openrouter_cost_unverified: "AI processing stopped because a request cost could not be verified.",
  openrouter_budget_exceeded: "An AI request exceeded its allowed cost.",
  openrouter_circuit_open: "AI processing is paused after a cost verification failure.",
  openrouter_key_budget_unverified: "The AI key spending limit could not be verified.",
  openrouter_key_limit_unsafe: "Set the OpenRouter key to a monthly or lifetime limit of $1 or less.",
};

export const SCANNER_AI_RELEVANT_SKIP_CODES = [
  ...Object.keys(FAILURE_MESSAGES),
  "llm_budget_capped",
  "llm_time_limit",
] as const;

export function scannerAiHealth(
  runs: readonly ScannerAiRun[],
  options: { readAvailable?: boolean; paused?: boolean; monthlyLlmUsdCap?: number } = {},
): ScannerAiHealth {
  const completed = runs
    .filter((run) => run.mode !== "dry_run" && !["running", "skipped"].includes(run.status))
    .slice()
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const success = completed.find((run) => (run.progress?.llmSucceeded ?? 0) > 0);
  const lastSuccessAt = success?.finished_at ?? success?.started_at ?? null;
  if (options.readAvailable === false) return { state: "unavailable", code: "ai_history_unavailable", message: "AI run history could not be read.", lastSuccessAt: null };
  if (options.paused) return { state: "idle", code: "scanner_paused", message: "The scanner is paused.", lastSuccessAt };
  if (options.monthlyLlmUsdCap === 0) return { state: "idle", code: "ai_disabled", message: "AI processing is disabled by the saved budget.", lastSuccessAt };

  // Idle scans and unverified attempts cannot replace a known AI outcome.
  const latest = completed.find((run) => (run.progress?.llmSucceeded ?? 0) > 0 || run.skips.some((code) => SCANNER_AI_RELEVANT_SKIP_CODES.includes(code)));
  if (!latest) return completed.some((run) => run.llm_calls_used > 0)
    ? { state: "idle", code: "ai_success_unverified", message: "Older run records do not verify successful AI responses.", lastSuccessAt }
    : { state: "idle", code: null, message: "No AI result is recorded yet.", lastSuccessAt };
  const failure = latest.skips.find((code) => code in FAILURE_MESSAGES);
  if (failure) return { state: (latest.progress?.llmSucceeded ?? 0) > 0 ? "limited" : "unavailable", code: failure, message: FAILURE_MESSAGES[failure], lastSuccessAt };
  if (latest.skips.includes("llm_budget_capped")) return { state: "limited", code: "llm_budget_capped", message: "AI processing reached a spending limit.", lastSuccessAt };
  if (latest.skips.includes("llm_time_limit")) return { state: "limited", code: "llm_time_limit", message: "AI processing reached the scan time limit.", lastSuccessAt };
  if ((latest.progress?.llmSucceeded ?? 0) > 0) return { state: "healthy", code: null, message: "The latest AI requests passed validation.", lastSuccessAt };
  return { state: "idle", code: "ai_success_unverified", message: "Older run records do not verify successful AI responses.", lastSuccessAt };
}
