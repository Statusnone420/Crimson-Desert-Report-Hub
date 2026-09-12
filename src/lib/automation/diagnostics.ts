/** Safe, versioned scanner diagnostics shared by the app and scheduled Worker. */
export const SCANNER_ATTEMPT_START_KEY = "scanner-attempt-start-v1";
export const SCANNER_EXECUTION_STATE_KEY = "scanner-execution-state-v1";
export const SCANNER_ATTEMPT_HEADER = "x-scanner-attempt-id";

export const SCANNER_STAGES = {
  request: "Calling the scanner",
  database_check: "Checking database access",
  retention: "Clearing expired source text",
  policy_read: "Reading scanner policy",
  schedule_read: "Reading recent run history",
  stale_run_cleanup: "Closing abandoned runs",
  active_run_read: "Checking for an active scan",
  budget_read: "Reading recorded spending",
  patch_read: "Verifying the current patch",
  patch_sync: "Refreshing official patch data",
  run_create: "Creating the run record",
  scan: "Collecting and processing sources",
  progress_write: "Saving scan progress",
  run_finalize: "Saving the completed run",
  skip_write: "Recording an intentional skip",
  health_read: "Reading AI health",
  cache_revalidate: "Refreshing the public pages",
  status_read: "Reading the previous trigger record",
  status_write: "Saving the trigger record",
} as const;

export const SCANNER_FAILURES = {
  database_timeout: "The database request timed out.",
  database_permission_denied: "The database rejected access to this operation.",
  database_unavailable: "The database operation did not complete.",
  operation_failed: "This operation failed. Review its private runtime log using the attempt ID.",
  configuration_missing: "The trigger's scanner endpoint or authorization secret is not configured.",
  transport_error: "The trigger could not reach the scanner endpoint.",
  request_timeout: "The scanner request exceeded its completion deadline.",
  http_error: "The scanner endpoint returned an unsuccessful HTTP response.",
  response_invalid: "The scanner endpoint did not return valid diagnostic data.",
  completion_missing: "The trigger started this attempt but no completion record arrived within the expected window.",
  current_patch_unavailable: "The current official patch could not be verified, so source processing did not start.",
} as const;

export type ScannerStage = keyof typeof SCANNER_STAGES;
export type ScannerFailureCode = keyof typeof SCANNER_FAILURES;
export type ScannerDiagnostic = { stage: ScannerStage; code: ScannerFailureCode };
export type ScannerOutcome = "success" | "partial" | "failed" | "skipped" | "running";
export type ScannerSkipReason = "paused" | "recent_run" | "scan_already_running";

export type ScannerAttemptStart = { id: string; startedAt: string };
export type ScannerAttempt = ScannerAttemptStart & {
  finishedAt: string;
  outcome: ScannerOutcome;
  diagnostics: ScannerDiagnostic[];
  errorCount: number;
  skipReason: ScannerSkipReason | null;
  nextEligibleAt: string | null;
  httpStatus: number | null;
};

export type ScannerExecutionState = {
  version: 1;
  latestAttempt: ScannerAttempt;
  lastSuccessfulScanAt: string | null;
  lastSuccessfulAiAt: string | null;
  lastFailedAttempt: ScannerAttempt | null;
};

export type ScannerExecutionRead = {
  state: "available" | "not_configured" | "unavailable" | "no_attempt" | "preview";
  code: string | null;
  detail: string;
  started: ScannerAttemptStart | null;
  snapshot: ScannerExecutionState | null;
};

export class ScannerOperationError extends Error {
  readonly diagnostic: ScannerDiagnostic;
  constructor(stage: ScannerStage, error: unknown) {
    super(`Scanner operation failed: ${stage}`, { cause: error });
    this.name = "ScannerOperationError";
    this.diagnostic = scannerDiagnostic(stage, error);
  }
}

/** Classify only; never copy upstream SQL, URLs, credentials, or response text. */
export function scannerDiagnostic(stage: ScannerStage, error: unknown): ScannerDiagnostic {
  if (error instanceof ScannerOperationError) return error.diagnostic;
  const value = record(error);
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : typeof value?.message === "string" ? value.message : "";
  const code = typeof value?.code === "string" ? value.code : "";
  if (["scan", "request", "patch_sync", "cache_revalidate", "status_read", "status_write"].includes(stage)) return { stage, code: "operation_failed" };
  if (/timeout|timed out/i.test(message) || code === "PGRST003" || code === "57014") return { stage, code: "database_timeout" };
  if (code === "42501" || /permission denied|row.level security/i.test(message)) return { stage, code: "database_permission_denied" };
  return { stage, code: "database_unavailable" };
}

export function describeScannerDiagnostic(diagnostic: ScannerDiagnostic): string {
  return `${SCANNER_STAGES[diagnostic.stage]}: ${SCANNER_FAILURES[diagnostic.code]}`;
}

export function scannerDiagnosticAction(diagnostic: ScannerDiagnostic): string {
  if (diagnostic.code === "database_permission_denied") return "Check service-role permissions and the deployed schema before another scan.";
  if (diagnostic.stage === "run_create" || diagnostic.stage === "run_finalize") {
    return "Inspect the attempt in the runtime logs and saved run history before retrying; a timed-out write may still have committed.";
  }
  if (diagnostic.stage === "budget_read") return "Restore access to recorded spending. Paid work remains blocked until that read succeeds.";
  if (diagnostic.code === "completion_missing") return "Check the Cloudflare invocation and Vercel runtime logs for this attempt.";
  return "Check this stage in the private runtime logs, then verify the next scheduled attempt.";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function scannerTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [seconds, fraction = ""] = value.slice(0, -1).split(".");
  return new Date(value).toISOString() === `${seconds}.${fraction.padEnd(3, "0")}Z`;
}

/** Supabase returns UTC offsets and may include microseconds; stored trigger times use canonical UTC. */
export function normalizeScannerTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return null;
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  return scannerTimestamp(normalized) ? normalized : null;
}

export function scannerAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseScannerDiagnostic(value: unknown): ScannerDiagnostic | null {
  const item = record(value);
  if (!item || typeof item.stage !== "string" || !Object.hasOwn(SCANNER_STAGES, item.stage) ||
    typeof item.code !== "string" || !Object.hasOwn(SCANNER_FAILURES, item.code)) return null;
  return { stage: item.stage as ScannerStage, code: item.code as ScannerFailureCode };
}

export function parseScannerAttemptStart(value: unknown): ScannerAttemptStart | null {
  const item = record(value);
  return item && scannerAttemptId(item.id) && scannerTimestamp(item.startedAt) ? { id: item.id, startedAt: item.startedAt } : null;
}

export function parseScannerAttempt(value: unknown): ScannerAttempt | null {
  const item = record(value);
  const start = parseScannerAttemptStart(value);
  if (!item || !start || !scannerTimestamp(item.finishedAt) || Date.parse(item.finishedAt) < Date.parse(start.startedAt) ||
    typeof item.outcome !== "string" || !["success", "partial", "failed", "skipped", "running"].includes(item.outcome) ||
    !Array.isArray(item.diagnostics) || item.diagnostics.length > 16 ||
    !Number.isSafeInteger(item.errorCount) || Number(item.errorCount) < 0 ||
    !(item.skipReason === null || item.skipReason === "paused" || item.skipReason === "recent_run" || item.skipReason === "scan_already_running") ||
    !(item.nextEligibleAt === null || scannerTimestamp(item.nextEligibleAt)) ||
    !(item.httpStatus === null || (Number.isInteger(item.httpStatus) && Number(item.httpStatus) >= 100 && Number(item.httpStatus) <= 599))) return null;
  const diagnostics = item.diagnostics.map(parseScannerDiagnostic);
  if (diagnostics.some((diagnostic) => diagnostic === null)) return null;
  const failed = item.outcome === "failed" || item.outcome === "partial";
  if (failed ? item.errorCount === 0 || diagnostics.length === 0 : item.errorCount !== 0 || diagnostics.length !== 0) return null;
  if (!failed && item.httpStatus !== null && Number(item.httpStatus) >= 400) return null;
  return { ...start, finishedAt: item.finishedAt, outcome: item.outcome as ScannerOutcome,
    diagnostics: diagnostics.filter((diagnostic) => diagnostic !== null), errorCount: Number(item.errorCount),
    skipReason: item.skipReason, nextEligibleAt: item.nextEligibleAt, httpStatus: item.httpStatus as number | null };
}

export function parseScannerExecutionState(value: unknown): ScannerExecutionState | null {
  const item = record(value);
  if (!item || item.version !== 1) return null;
  const latestAttempt = parseScannerAttempt(item.latestAttempt);
  const lastFailedAttempt = item.lastFailedAttempt === null ? null : parseScannerAttempt(item.lastFailedAttempt);
  if (!latestAttempt || (item.lastFailedAttempt !== null && !lastFailedAttempt) ||
    !(item.lastSuccessfulScanAt === null || scannerTimestamp(item.lastSuccessfulScanAt)) ||
    !(item.lastSuccessfulAiAt === null || scannerTimestamp(item.lastSuccessfulAiAt))) return null;
  const latestMs = Date.parse(latestAttempt.finishedAt);
  if ((lastFailedAttempt && (!["failed", "partial"].includes(lastFailedAttempt.outcome) || Date.parse(lastFailedAttempt.finishedAt) > latestMs)) ||
    (item.lastSuccessfulScanAt && Date.parse(item.lastSuccessfulScanAt) > latestMs) ||
    (item.lastSuccessfulAiAt && Date.parse(item.lastSuccessfulAiAt) > latestMs)) return null;
  return { version: 1, latestAttempt, lastFailedAttempt,
    lastSuccessfulScanAt: item.lastSuccessfulScanAt, lastSuccessfulAiAt: item.lastSuccessfulAiAt };
}

export function nextHourlyScannerWake(now: Date, eligibleAt: string | null = null): string {
  const eligible = eligibleAt && scannerTimestamp(eligibleAt) ? Date.parse(eligibleAt) - 2 * 60_000 : 0;
  return new Date(Math.ceil(Math.max(now.getTime() + 1, eligible) / 3_600_000) * 3_600_000).toISOString();
}
