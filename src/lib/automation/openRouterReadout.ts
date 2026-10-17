import { appendOpenRouterDiagnostics, type OpenRouterDiagnostic } from "./openRouterDiagnostics";
import { parseOpenRouterAttempt, parseOpenRouterCheckpointFailure, parseOpenRouterTraceJournal, type OpenRouterAttempt, type OpenRouterCheckpointFailure } from "./openRouterTrace";
import { describeCheckpointWrite } from "./checkpointWrite";

export type ScannerAiEvidence = {
  version: 1;
  attemptedCalls: number | null;
  validatedCalls: number | null;
  costState: "verified" | "reserved_unknown" | "not_attempted" | "unknown";
  latestAttempt: OpenRouterAttempt | null;
  lastProblem: OpenRouterAttempt | null;
  diagnostic: OpenRouterDiagnostic | null;
  checkpointFailures: number;
  dropped: number;
  lastCheckpointWrite?: OpenRouterCheckpointFailure;
};
const counter = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000 ? value : null;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function scannerAiEvidence(progress: unknown, attemptedCalls: unknown, skips: readonly string[]): ScannerAiEvidence | null {
  const value = record(progress);
  const journal = parseOpenRouterTraceJournal(value?.openRouterTrace);
  const diagnostics = Array.isArray(value?.openRouterDiagnostics)
    ? appendOpenRouterDiagnostics(undefined, value.openRouterDiagnostics as OpenRouterDiagnostic[]) : [];
  if (!journal && diagnostics.length === 0) return null;
  const attempts = journal?.attempts ?? [];
  const attempted = counter(attemptedCalls);
  const unknown = skips.includes("openrouter_cost_unverified") || attempts.some((item) =>
    (item.operation === "extraction" || item.operation === "claim_mapping") && item.costState === "reserved_unknown");
  const verifiedCalls = attempts.filter((item) =>
    (item.operation === "extraction" || item.operation === "claim_mapping") && item.costState === "verified").length;
  return { version: 1, attemptedCalls: attempted, validatedCalls: counter(value?.llmSucceeded),
    costState: ["verified", "reserved_unknown", "not_attempted", "unknown"].includes(String(value?.llmCostState))
      ? value!.llmCostState as ScannerAiEvidence["costState"] : unknown ? "reserved_unknown" : attempted === 0 ? "not_attempted" :
      attempted !== null && verifiedCalls >= attempted ? "verified" : "unknown",
    latestAttempt: attempts.at(-1) ?? null,
    lastProblem: attempts.findLast((item) => item.outcome !== "success" && item.outcome !== "pending") ??
      attempts.findLast((item) => item.outcome === "pending") ?? null,
    diagnostic: diagnostics.at(-1) ?? null, checkpointFailures: journal?.checkpointFailures ?? 0, dropped: journal?.dropped ?? 0,
    ...(journal?.checkpointWriteFailures?.length ? { lastCheckpointWrite: journal.checkpointWriteFailures.at(-1) } : {}) };
}

/** Strictly bounded optional Worker response/state extension; historical payloads stay valid. */
export function parseScannerAiEvidence(value: unknown): ScannerAiEvidence | null {
  const item = record(value);
  if (!item || item.version !== 1 || !(item.attemptedCalls === null || counter(item.attemptedCalls) !== null) ||
    !(item.validatedCalls === null || counter(item.validatedCalls) !== null) ||
    typeof item.costState !== "string" || !["verified", "reserved_unknown", "not_attempted", "unknown"].includes(item.costState) ||
    counter(item.checkpointFailures) === null || counter(item.dropped) === null) return null;
  const latestAttempt = item.latestAttempt === null ? null : parseOpenRouterAttempt(item.latestAttempt);
  const lastProblem = item.lastProblem === null ? null : parseOpenRouterAttempt(item.lastProblem);
  const diagnostic = item.diagnostic === null ? null : appendOpenRouterDiagnostics(undefined, [item.diagnostic as OpenRouterDiagnostic])[0];
  if ((item.latestAttempt !== null && !latestAttempt) || (item.lastProblem !== null && !lastProblem) ||
    (item.diagnostic !== null && !diagnostic)) return null;
  const lastCheckpointWrite = parseOpenRouterCheckpointFailure(item.lastCheckpointWrite);
  return { version: 1, attemptedCalls: item.attemptedCalls as number | null, validatedCalls: item.validatedCalls as number | null,
    costState: item.costState as ScannerAiEvidence["costState"], latestAttempt, lastProblem, diagnostic: diagnostic ?? null,
    checkpointFailures: item.checkpointFailures as number, dropped: item.dropped as number,
    ...(lastCheckpointWrite ? { lastCheckpointWrite } : {}) };
}

const OPERATIONS: Record<OpenRouterAttempt["operation"], string> = {
  key_budget: "Key budget check", extraction: "Issue extraction", claim_mapping: "Claim mapping", cost_audit: "Cost verification",
};
export function describeOpenRouterAttempt(attempt: OpenRouterAttempt): string {
  const result = attempt.outcome === "pending" ? "completion not recorded; provider outcome unknown" : attempt.outcome.replaceAll("_", " ");
  const phase = attempt.headersAfterMs === null ? "no response headers observed" :
    attempt.bodyAfterMs === null ? `headers after ${attempt.headersAfterMs} ms; body completion not observed` :
      `headers after ${attempt.headersAfterMs} ms; body decoded after ${attempt.bodyAfterMs} ms`;
  return `${OPERATIONS[attempt.operation]} · ${result} · ${phase} · ${attempt.elapsedMs} ms observed${attempt.httpStatus === null ? "" : ` · HTTP ${attempt.httpStatus}`}${attempt.errorClass ? ` · ${attempt.errorClass.replaceAll("_", " ")}` : ""}`;
}

export function describeOpenRouterDiagnostic(diagnostic: OpenRouterDiagnostic): string {
  const routing = diagnostic.code === "request_http_failure" && diagnostic.httpStatus === 404 && diagnostic.routingRefusal
    ? ` · Routing refusal category: ${diagnostic.routingRefusal.replaceAll("_", " ")}${diagnostic.routingMessage ? ` · OpenRouter said: "${diagnostic.routingMessage}"` : ""}` : "";
  return `${diagnostic.code.replaceAll("_", " ")} · ${diagnostic.elapsedMs} ms${diagnostic.httpStatus === null ? " · no response headers observed" : ` · HTTP ${diagnostic.httpStatus}`}${routing}`;
}

export function scannerAiEvidenceLines(evidence: ScannerAiEvidence): string[] {
  const problem = evidence.lastProblem ?? evidence.latestAttempt;
  return [
    `Recorded AI counters: ${evidence.attemptedCalls ?? "unrecorded"} attempted; ${evidence.validatedCalls ?? "unrecorded"} validated.`,
    evidence.costState === "reserved_unknown" ? problem?.outcome === "success" && problem.costState === "verified"
      ? "The provider result was validated; accounting still includes a conservative reservation."
      : "AI cost includes a conservative reservation; provider completion/charge is unverified." :
      evidence.costState === "verified" ? "Recorded AI cost verified." : evidence.costState === "not_attempted" ? "No inference call recorded." : "AI cost verification unavailable.",
    ...(problem ? [describeOpenRouterAttempt(problem), `Local operation: ${problem.id}; started ${problem.startedAt}; request deadline ${problem.deadlineAt ?? "not recorded"}.`] : []),
    ...(problem?.outcome === "pending" ? ["The unfinished operation may have started inference after its checkpoint; recorded counters can lag its provider outcome."] : []),
    ...(evidence.diagnostic ? [describeOpenRouterDiagnostic(evidence.diagnostic)] : []),
    ...(evidence.diagnostic?.keyBudgetValidation ? [`Budget fields: limit ${evidence.diagnostic.keyBudgetValidation.limit}; remaining ${evidence.diagnostic.keyBudgetValidation.limit_remaining}; reset ${evidence.diagnostic.keyBudgetValidation.limit_reset}; monthly usage ${evidence.diagnostic.keyBudgetValidation.usage_monthly}; remaining within limit ${evidence.diagnostic.keyBudgetValidation.remainingWithinLimit ?? "unverified"}.`] : []),
    ...(evidence.checkpointFailures > 0 ? [`${evidence.checkpointFailures} request checkpoint writes failed; some timing evidence may be missing.`] : []),
    ...(evidence.lastCheckpointWrite ? [
      `Last failed ${evidence.lastCheckpointWrite.phase} checkpoint: ${describeCheckpointWrite(evidence.lastCheckpointWrite)}.`,
      `Checkpoint local operation: ${evidence.lastCheckpointWrite.operationId}.`,
      ...(evidence.lastCheckpointWrite.reason === "local_deadline" ? ["App deadline expiry does not prove that the database rejected or rolled back the write."] : []),
    ] : evidence.checkpointFailures > 0 ? ["Failed-write phase and cause were not recorded in this evidence."] : []),
    ...(evidence.dropped > 0 ? [`${evidence.dropped} older operation records omitted from the bounded journal.`] : []),
  ];
}
