import { parseOpenRouterTraceJournal } from "./openRouterTrace";

export type ScannerAiHealth = {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
  /** Current spending policy, independent of the retained scanner outcome. */
  currentSpending?: "within_limits" | "month_limit" | "month_paused" | "blocked" | "disabled" | "unverified";
  lastScanResult?: Pick<ScannerAiHealth, "state" | "code" | "message">;
};

export function scannerAiSpendingMessage(health: ScannerAiHealth): string {
  switch (health.currentSpending) {
    case "within_limits": return "Current spending checks allow AI requests. Spending eligibility does not establish provider availability.";
    case "month_limit": return "AI spending reached a current UTC-month limit.";
    case "month_paused": return "AI is paused for the current UTC month after an accounting anomaly.";
    case "blocked": return "Current accounting checks block AI requests.";
    case "disabled": return "AI is disabled by the saved allowance.";
    default: return "Current AI spending eligibility could not be verified.";
  }
}

export function scannerAiResultLabel(health: ScannerAiHealth): string {
  const result = scannerAiLastResult(health);
  if (result.code === "ai_history_unavailable") return "Unverified";
  return result.state === "unavailable" ? "Failed" : result.state === "limited" ? "Partial or limited" :
    result.state === "healthy" ? "Validated" : "Idle";
}

export function scannerAiLastResult(health: ScannerAiHealth): NonNullable<ScannerAiHealth["lastScanResult"]> {
  return health.lastScanResult ?? health;
}

export type ScannerAiRun = {
  started_at: string;
  finished_at?: string | null;
  status: string;
  mode?: string;
  skips: string[];
  llm_calls_used: number;
  progress?: { llmSucceeded?: number; llmCostUsd?: number; modelPreset?: string | null; openRouterTrace?: unknown } | null;
};

const FAILURE_MESSAGES: Record<string, string> = {
  ai_settings_unavailable: "AI settings could not be loaded or validated; model requests are stopped.",
  ai_connection_changed: "The AI connection changed. Test and activate the model again.",
  ai_health_unavailable: "AI health history could not be saved.",
  openrouter_context_limit: "The request exceeds the selected model's context limit; model requests are stopped.",
  accounting_unavailable: "The accounting migration is required before paid processing can resume.",
  reservation_unacknowledged: "Paid processing stopped because its reservation was not acknowledged.",
  settlement_unacknowledged: "Paid processing stopped because its accounting save is unconfirmed.",
  spending_blocked: "Paid processing stopped at an accounting or execution limit.",
  openrouter_no_route: "No AI provider matches the selected route and price limit.",
  openrouter_missing_config: "The AI key is missing.",
  openrouter_paid_model: "The selected AI model is not approved.",
  openrouter_provider_failure: "The AI provider could not complete a request.",
  openrouter_invalid_json: "The AI response did not pass validation.",
  openrouter_unexpected_charge: "AI processing stopped after an unexpected charge.",
  openrouter_cost_unverified: "AI processing stopped because a request cost could not be verified.",
  openrouter_budget_exceeded: "An AI request exceeded its allowed cost.",
  openrouter_circuit_open: "AI processing is paused: a charge exceeded its limit this month, or spending could not be read.",
  openrouter_key_budget_unverified: "The AI key spending limit could not be verified.",
  openrouter_key_limit_unsafe: "Set the OpenRouter key to a monthly or lifetime limit of $1 or less.",
};

/** Fixed text for a known AI failure code; null for anything else. */
export function scannerAiFailureMessage(code: string): string | null {
  return Object.hasOwn(FAILURE_MESSAGES, code) ? FAILURE_MESSAGES[code] : null;
}

export const SCANNER_AI_RELEVANT_SKIP_CODES = [
  ...Object.keys(FAILURE_MESSAGES),
  "llm_budget_capped",
  "llm_time_limit",
] as const;

export function scannerAiRelevantSkipCodes(llmBudgetCapped: boolean): readonly string[] {
  return llmBudgetCapped
    ? SCANNER_AI_RELEVANT_SKIP_CODES
    : SCANNER_AI_RELEVANT_SKIP_CODES.filter((code) => code !== "llm_budget_capped");
}

function finiteTimestamp(value: string | null | undefined): number | null {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function completionTimestamp(run: ScannerAiRun): number {
  return finiteTimestamp(run.finished_at) ?? finiteTimestamp(run.started_at) ?? Number.NEGATIVE_INFINITY;
}

function compareCompletedRuns(a: ScannerAiRun, b: ScannerAiRun): number {
  const aCompleted = completionTimestamp(a);
  const bCompleted = completionTimestamp(b);
  if (aCompleted !== bCompleted) return bCompleted > aCompleted ? 1 : -1;
  const aStarted = finiteTimestamp(a.started_at) ?? Number.NEGATIVE_INFINITY;
  const bStarted = finiteTimestamp(b.started_at) ?? Number.NEGATIVE_INFINITY;
  if (aStarted !== bStarted) return bStarted > aStarted ? 1 : -1;
  const aKey = `${a.finished_at ?? ""}\u0000${a.started_at}\u0000${a.status}\u0000${a.skips.join("\u0000")}`;
  const bKey = `${b.finished_at ?? ""}\u0000${b.started_at}\u0000${b.status}\u0000${b.skips.join("\u0000")}`;
  return bKey.localeCompare(aKey);
}

function hasUnfinishedInference(run: ScannerAiRun): boolean {
  return parseOpenRouterTraceJournal(run.progress?.openRouterTrace)?.attempts.some((attempt) =>
    (attempt.operation === "extraction" || attempt.operation === "claim_mapping") && attempt.outcome === "pending") ?? false;
}

export function scannerAiHealth(
  runs: readonly ScannerAiRun[],
  options: { readAvailable?: boolean; paused?: boolean; monthlyLlmUsdCap?: number; llmBudgetCapped?: boolean } = {},
): ScannerAiHealth {
  const completed = runs
    .filter((run) => run.mode !== "dry_run" && !["running", "skipped"].includes(run.status))
    .slice()
    .sort(compareCompletedRuns);
  const success = completed.find((run) => (run.progress?.llmSucceeded ?? 0) > 0);
  const lastSuccessAt = success
    ? finiteTimestamp(success.finished_at) !== null
      ? success.finished_at ?? null
      : finiteTimestamp(success.started_at) !== null
        ? success.started_at
        : null
    : null;
  if (options.readAvailable === false) return { state: "unavailable", code: "ai_history_unavailable", message: "AI run history could not be read.", lastSuccessAt: null };
  if (options.paused) return { state: "idle", code: "scanner_paused", message: "The scanner is paused.", lastSuccessAt };
  if (options.monthlyLlmUsdCap === 0) return { state: "idle", code: "ai_disabled", message: "AI processing is disabled by the saved budget.", lastSuccessAt };

  // Idle scans and unverified attempts cannot replace a known AI outcome.
  const relevantSkipCodes = scannerAiRelevantSkipCodes(options.llmBudgetCapped !== false);
  const latest = completed.find((run) => (run.progress?.llmSucceeded ?? 0) > 0 || hasUnfinishedInference(run) || run.skips.some((code) => relevantSkipCodes.includes(code)));
  if (!latest) return completed.some((run) => run.llm_calls_used > 0)
    ? { state: "idle", code: "ai_success_unverified", message: "Older run records do not verify successful AI responses.", lastSuccessAt }
    : { state: "idle", code: null, message: "No AI result is recorded yet.", lastSuccessAt };
  const failure = latest.skips.find((code) => code in FAILURE_MESSAGES);
  if (failure) return { state: (latest.progress?.llmSucceeded ?? 0) > 0 ? "limited" : "unavailable", code: failure, message: FAILURE_MESSAGES[failure], lastSuccessAt };
  if (hasUnfinishedInference(latest)) return { state: (latest.progress?.llmSucceeded ?? 0) > 0 ? "limited" : "unavailable",
    code: "ai_completion_unverified", message: "An AI operation has no saved completion. Whether inference started or completed is unknown.", lastSuccessAt };
  if (options.llmBudgetCapped !== false && latest.skips.includes("llm_budget_capped")) return { state: "limited", code: "llm_budget_capped", message: "AI processing reached a spending limit.", lastSuccessAt };
  if (latest.skips.includes("llm_time_limit")) return { state: "limited", code: "llm_time_limit", message: "AI processing reached the scan time limit.", lastSuccessAt };
  if ((latest.progress?.llmSucceeded ?? 0) > 0) return { state: "healthy", code: null, message: "The latest AI requests passed validation.", lastSuccessAt };
  return { state: "idle", code: "ai_success_unverified", message: "Older run records do not verify successful AI responses.", lastSuccessAt };
}

/** Keep policy-idle semantics for the Worker while displaying retained facts. */
export function scannerAiHealthWithResult(
  runs: readonly ScannerAiRun[], options: Parameters<typeof scannerAiHealth>[1] = {},
): ScannerAiHealth {
  const { state, code, message } = scannerAiHealth(runs, { readAvailable: options.readAvailable, llmBudgetCapped: options.llmBudgetCapped });
  return { ...scannerAiHealth(runs, options), lastScanResult: { state, code, message } };
}
