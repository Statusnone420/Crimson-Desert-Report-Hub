/** Private operational facts only. This module is also used by the cron Worker. */
import { parseCheckpointWriteEvidence, type CheckpointWriteEvidence } from "./checkpointWrite";

export const OPENROUTER_OPERATIONS = ["key_budget", "extraction", "claim_mapping", "cost_audit"] as const;
export const OPENROUTER_OUTCOMES = ["pending", "success", "timeout", "transport_failure", "http_failure", "decode_failure", "validation_failure", "cost_unverified", "budget_exceeded", "deadline"] as const;
const STAGES = ["checkpoint", "fetch", "body", "validation", "cost"] as const;
const ERROR_CLASSES = ["timeout", "abort", "dns", "connect", "connection", "type_error", "decode", "unknown"] as const;
const COST_STATES = ["not_attempted", "verified", "reserved_unknown"] as const;
const MAX_MS = 180_000;
const MAX_RECORDS = 20;
const MAX_COUNT = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OpenRouterAttempt = {
  id: string;
  parentId: string | null;
  operation: (typeof OPENROUTER_OPERATIONS)[number];
  attempt: number;
  startedAt: string;
  requestStartedAt: string | null;
  deadlineAt: string | null;
  sharedDeadlineAt: string | null;
  stage: (typeof STAGES)[number];
  outcome: (typeof OPENROUTER_OUTCOMES)[number];
  elapsedMs: number;
  checkpointMs: number | null;
  headersAfterMs: number | null;
  bodyAfterMs: number | null;
  httpStatus: number | null;
  errorClass: (typeof ERROR_CLASSES)[number] | null;
  costState: (typeof COST_STATES)[number];
};
export type OpenRouterCheckpointFailure = CheckpointWriteEvidence & { operationId: string; phase: "start" | "terminal" };
export type OpenRouterTraceJournal = { version: 1; attempts: OpenRouterAttempt[]; dropped: number; checkpointFailures: number;
  checkpointWriteFailures?: OpenRouterCheckpointFailure[] };
export type OpenRouterAttemptReporter = (attempt: OpenRouterAttempt) => void | Promise<void>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function boundedNumber(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/** Reconstruct instead of spreading caller data, including nested error objects. */
export function parseOpenRouterAttempt(value: unknown): OpenRouterAttempt | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || !UUID.test(item.id) ||
    !(item.parentId === null || (typeof item.parentId === "string" && UUID.test(item.parentId))) ||
    !oneOf(item.operation, OPENROUTER_OPERATIONS) || !boundedNumber(item.attempt, 3) || item.attempt < 1 ||
    !timestamp(item.startedAt) || !oneOf(item.stage, STAGES) || !oneOf(item.outcome, OPENROUTER_OUTCOMES) ||
    !oneOf(item.costState, COST_STATES) || !boundedNumber(item.elapsedMs, MAX_MS) ||
    !(item.errorClass === null || oneOf(item.errorClass, ERROR_CLASSES)) ||
    !(item.httpStatus === null || (boundedNumber(item.httpStatus, 599) && item.httpStatus >= 100))) return null;
  for (const field of ["requestStartedAt", "deadlineAt", "sharedDeadlineAt"] as const) {
    if (!(item[field] === null || timestamp(item[field]))) return null;
  }
  for (const field of ["checkpointMs", "headersAfterMs", "bodyAfterMs"] as const) {
    if (!(item[field] === null || boundedNumber(item[field], MAX_MS))) return null;
  }
  if ((item.requestStartedAt !== null && Date.parse(item.requestStartedAt as string) < Date.parse(item.startedAt)) ||
    (item.deadlineAt !== null && (item.requestStartedAt === null || Date.parse(item.deadlineAt as string) < Date.parse(item.requestStartedAt as string))) ||
    (item.headersAfterMs !== null && item.bodyAfterMs !== null && Number(item.bodyAfterMs) < Number(item.headersAfterMs))) return null;
  return { id: item.id, parentId: item.parentId as string | null, operation: item.operation, attempt: item.attempt,
    startedAt: item.startedAt, requestStartedAt: item.requestStartedAt as string | null, deadlineAt: item.deadlineAt as string | null,
    sharedDeadlineAt: item.sharedDeadlineAt as string | null, stage: item.stage, outcome: item.outcome,
    elapsedMs: item.elapsedMs, checkpointMs: item.checkpointMs as number | null,
    headersAfterMs: item.headersAfterMs as number | null, bodyAfterMs: item.bodyAfterMs as number | null,
    httpStatus: item.httpStatus as number | null, errorClass: item.errorClass, costState: item.costState };
}

export function parseOpenRouterTraceJournal(value: unknown): OpenRouterTraceJournal | null {
  const item = record(value);
  if (!item || item.version !== 1 || !Array.isArray(item.attempts) || item.attempts.length > MAX_RECORDS ||
    !boundedNumber(item.dropped, MAX_COUNT) || !boundedNumber(item.checkpointFailures, MAX_COUNT)) return null;
  const attempts = item.attempts.map(parseOpenRouterAttempt);
  if (attempts.some((attempt) => attempt === null)) return null;
  const safe = attempts.filter((attempt): attempt is OpenRouterAttempt => attempt !== null);
  if (new Set(safe.map((attempt) => attempt.id)).size !== safe.length) return null;
  const failures = Array.isArray(item.checkpointWriteFailures) && item.checkpointWriteFailures.length <= MAX_RECORDS
    ? item.checkpointWriteFailures.map(parseOpenRouterCheckpointFailure).filter((failure): failure is OpenRouterCheckpointFailure => failure !== null) : [];
  return { version: 1, attempts: safe, dropped: item.dropped, checkpointFailures: item.checkpointFailures,
    ...(failures.length ? { checkpointWriteFailures: failures } : {}) };
}

export function parseOpenRouterCheckpointFailure(value: unknown): OpenRouterCheckpointFailure | null {
  const item = record(value);
  const evidence = parseCheckpointWriteEvidence(item);
  if (!item || !evidence || typeof item.operationId !== "string" || !UUID.test(item.operationId) ||
    !oneOf(item.phase, ["start", "terminal"] as const)) return null;
  return { operationId: item.operationId, phase: item.phase, ...evidence };
}

/** Retain first failure and recent failures, independently of terminal AI success. */
export function recordOpenRouterCheckpointFailure(current: OpenRouterTraceJournal | undefined, attempt: OpenRouterAttempt,
  evidence: CheckpointWriteEvidence | null): OpenRouterTraceJournal {
  const journal = parseOpenRouterTraceJournal(current) ?? { version: 1, attempts: [], dropped: 0, checkpointFailures: 0 };
  journal.checkpointFailures = Math.min(MAX_COUNT, journal.checkpointFailures + 1);
  const failure = evidence && parseOpenRouterCheckpointFailure({ ...evidence, operationId: attempt.id,
    phase: attempt.outcome === "pending" ? "start" : "terminal" });
  if (failure) {
    const failures = [...(journal.checkpointWriteFailures ?? []), failure];
    journal.checkpointWriteFailures = failures.length > MAX_RECORDS ? [failures[0], ...failures.slice(-(MAX_RECORDS - 1))] : failures;
  }
  return journal;
}

export function upsertOpenRouterAttempt(current: OpenRouterTraceJournal | undefined, incoming: OpenRouterAttempt): OpenRouterTraceJournal {
  const journal: OpenRouterTraceJournal = parseOpenRouterTraceJournal(current) ?? { version: 1, attempts: [], dropped: 0, checkpointFailures: 0 };
  const attempt = parseOpenRouterAttempt(incoming);
  if (!attempt) return journal;
  const index = journal.attempts.findIndex((item) => item.id === attempt.id);
  if (index >= 0) journal.attempts[index] = attempt;
  else journal.attempts.push(attempt);
  if (journal.attempts.length > MAX_RECORDS) {
    // Retain the first failure (or unfinished request) as well as recent facts.
    const first = journal.attempts.find((item) => item.outcome !== "success" && item.outcome !== "pending") ??
      journal.attempts.find((item) => item.outcome === "pending");
    const recent = journal.attempts.filter((item) => item.id !== first?.id).slice(-(MAX_RECORDS - (first ? 1 : 0)));
    journal.attempts = first ? [first, ...recent] : recent;
    journal.dropped = Math.min(MAX_COUNT, journal.dropped + 1);
  }
  return journal;
}

export function hasPendingOpenRouterInference(journal: OpenRouterTraceJournal | undefined): boolean {
  return journal?.attempts.some((attempt) => (attempt.operation === "extraction" || attempt.operation === "claim_mapping") && attempt.outcome === "pending") ?? false;
}

/** Classify known platform codes without copying messages, URLs, headers or causes. */
function errorClass(error: unknown): OpenRouterAttempt["errorClass"] {
  const value = record(error);
  const cause = record(value?.cause);
  const code = cause?.code ?? value?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ECONNREFUSED") return "connect";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection";
  if (value?.name === "AbortError") return "abort";
  if (value?.name === "TypeError") return "type_error";
  return "unknown";
}

/** Observes the existing request deadline; it never sends requests or retries. */
export class OpenRouterAttemptTrace {
  private readonly clockStart = performance.now();
  private fetchClock: number | null = null;
  private finished = false;
  private readonly value: OpenRouterAttempt;

  constructor(operation: OpenRouterAttempt["operation"], attempt: number, private readonly reporter?: OpenRouterAttemptReporter,
    private readonly sharedDeadlineAtMs?: number, parentId: string | null = null) {
    this.value = { id: crypto.randomUUID(), parentId, operation, attempt, startedAt: new Date(Date.now()).toISOString(),
      sharedDeadlineAt: sharedDeadlineAtMs !== undefined && Number.isFinite(sharedDeadlineAtMs) ? new Date(sharedDeadlineAtMs).toISOString() : null,
      requestStartedAt: null, deadlineAt: null, stage: "checkpoint", outcome: "pending", elapsedMs: 0,
      checkpointMs: null, headersAfterMs: null, bodyAfterMs: null, httpStatus: null, errorClass: null,
      costState: operation === "extraction" || operation === "claim_mapping" ? "reserved_unknown" : "not_attempted" };
  }
  get id(): string { return this.value.id; }
  private elapsed(start = this.clockStart): number { return Math.max(0, Math.min(MAX_MS, Math.floor(performance.now() - start))); }
  private async emit(): Promise<void> {
    if (!this.reporter) return;
    try { await this.reporter({ ...this.value, elapsedMs: this.elapsed() }); } catch { /* Telemetry never changes provider accounting. */ }
  }
  async start(): Promise<void> { await this.emit(); }
  fetchStarted(maximumMs: number, sharedDeadlineApplies = true): void {
    if (this.finished) return;
    this.fetchClock = performance.now();
    this.value.checkpointMs = this.elapsed();
    const requestStartedAtMs = Date.now();
    this.value.requestStartedAt = new Date(requestStartedAtMs).toISOString();
    this.value.deadlineAt = new Date(Math.min(requestStartedAtMs + maximumMs, sharedDeadlineApplies ? this.sharedDeadlineAtMs ?? Infinity : Infinity)).toISOString();
    this.value.stage = "fetch";
  }
  headers(status: number): void {
    if (this.finished) return;
    this.value.httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.value.headersAfterMs = this.fetchClock === null ? null : this.elapsed(this.fetchClock);
    this.value.stage = "body";
  }
  body(): void {
    if (this.finished) return;
    this.value.bodyAfterMs = this.fetchClock === null ? null : this.elapsed(this.fetchClock);
    this.value.stage = "validation";
  }
  cost(): void { if (!this.finished) this.value.stage = "cost"; }
  validation(): void { if (!this.finished) this.value.stage = "validation"; }
  async finish(outcome: Exclude<OpenRouterAttempt["outcome"], "pending">, costState = this.value.costState, error?: unknown): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.value.outcome = outcome;
    this.value.costState = costState;
    this.value.errorClass = outcome === "timeout" ? "timeout" : outcome === "decode_failure" ? "decode" :
      error === undefined ? null : errorClass(error);
    await this.emit();
  }
}
