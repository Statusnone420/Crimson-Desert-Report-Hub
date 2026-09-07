export const OPENROUTER_DIAGNOSTIC_CODES = [
  "request_timeout",
  "request_transport_failure",
  "response_decode_failure",
  "request_http_failure",
  "response_validation_failure",
  "response_cost_missing",
  "response_id_missing",
  "generation_lookup_timeout",
  "generation_lookup_transport_failure",
  "generation_lookup_decode_failure",
  "generation_lookup_http_failure",
  "generation_lookup_cost_missing",
  "generation_lookup_deadline",
  "generation_lookup_verified",
] as const;

export type OpenRouterDiagnosticCode = (typeof OPENROUTER_DIAGNOSTIC_CODES)[number];

export type OpenRouterDiagnostic = {
  code: OpenRouterDiagnosticCode;
  elapsedMs: number;
  httpStatus: number | null;
  attempts: number;
};

export type OpenRouterDiagnosticReporter = (diagnostic: OpenRouterDiagnostic) => void;

/** A diagnostic sink must not change the provider outcome or accounting. */
export function reportOpenRouterDiagnostic(
  reporter: OpenRouterDiagnosticReporter | undefined,
  diagnostic: OpenRouterDiagnostic,
): void {
  if (!reporter) return;
  try {
    // Async callbacks are assignable to a void-returning callback in TypeScript.
    void Promise.resolve(reporter(diagnostic)).catch(() => {});
  } catch {
    // Best-effort telemetry: the caller still returns its actual provider result.
  }
}

const CODE_SET = new Set<string>(OPENROUTER_DIAGNOSTIC_CODES);
const MAX_ELAPSED_MS = 180_000;
const MAX_ATTEMPTS = 3;
const MAX_DIAGNOSTICS = 32;

function boundedElapsedMs(startedAtMs: number): number {
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.min(MAX_ELAPSED_MS, Math.floor(Date.now() - startedAtMs)));
}

function boundedHttpStatus(status: number | null): number | null {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function boundedAttempts(attempts: number): number {
  if (!Number.isFinite(attempts)) return 0;
  return Math.max(0, Math.min(MAX_ATTEMPTS, Math.floor(attempts)));
}

export function createOpenRouterDiagnostic(
  code: OpenRouterDiagnosticCode,
  startedAtMs: number,
  httpStatus: number | null,
  attempts: number,
): OpenRouterDiagnostic {
  return {
    code,
    elapsedMs: boundedElapsedMs(startedAtMs),
    httpStatus: boundedHttpStatus(httpStatus),
    attempts: boundedAttempts(attempts),
  };
}

function reconstructDiagnostic(value: unknown): OpenRouterDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.code !== "string" || !CODE_SET.has(candidate.code)) return null;
  if (typeof candidate.elapsedMs !== "number" || !Number.isInteger(candidate.elapsedMs) || candidate.elapsedMs < 0 || candidate.elapsedMs > MAX_ELAPSED_MS) return null;
  if (candidate.httpStatus !== null && (typeof candidate.httpStatus !== "number" || !Number.isInteger(candidate.httpStatus) || candidate.httpStatus < 100 || candidate.httpStatus > 599)) return null;
  if (typeof candidate.attempts !== "number" || !Number.isInteger(candidate.attempts) || candidate.attempts < 0 || candidate.attempts > MAX_ATTEMPTS) return null;
  return {
    code: candidate.code as OpenRouterDiagnosticCode,
    elapsedMs: candidate.elapsedMs,
    httpStatus: candidate.httpStatus,
    attempts: candidate.attempts,
  };
}

/** Preserve bounded diagnostic facts only; never carry response or request payloads. */
export function appendOpenRouterDiagnostics(
  current: readonly OpenRouterDiagnostic[] | undefined,
  incoming: readonly OpenRouterDiagnostic[],
): OpenRouterDiagnostic[] {
  return [...(current ?? []), ...incoming]
    .map(reconstructDiagnostic)
    .filter((diagnostic): diagnostic is OpenRouterDiagnostic => diagnostic !== null)
    .slice(-MAX_DIAGNOSTICS);
}
