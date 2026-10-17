import "server-only";

import type { createServiceClient } from "@/lib/supabase";
import type { ScanIntent } from "@/lib/automation/memory";
import type { RunProgress } from "@/lib/automation/run";
import { parseCheckpointWriteEvidence, type CheckpointWriteEvidence } from "./checkpointWrite";
import { guardedProgress, type GuardedRun } from "./accounting.server";
import { withScannerIoObservation, type ScannerIoObservation } from "./executionContext.server";

const PROGRESS_RETRY_STATUS = 504;
const PROGRESS_RETRY_DELAY_MS = 250;
const PROGRESS_RECOVERY_WINDOW_MS = 12_000;
const PROGRESS_RETRY_ATTEMPT_MS = 6_000;

type ProgressClient = ReturnType<typeof createServiceClient>;
type ProgressPayload = { progress: RunProgress; intent: ScanIntent };
type ProgressResponse = { error: unknown; status?: number };
type ProgressObserver = { requests: number; response: ProgressResponse | null; transportFailed: boolean };

class ProgressCheckpointError extends Error {
  readonly code?: string;
  readonly status?: number;
  constructor(error: unknown, readonly checkpoint: CheckpointWriteEvidence) {
    const value = error && typeof error === "object" ? error as Record<string, unknown> : null;
    super(error instanceof Error ? error.message : typeof value?.message === "string" ? value.message : "Database request failed", { cause: error });
    this.name = "ProgressCheckpointError";
    if (typeof value?.code === "string") this.code = value.code;
    if (typeof value?.status === "number") this.status = value.status;
  }
}

export function progressCheckpointEvidence(error: unknown): CheckpointWriteEvidence | null {
  return error instanceof ProgressCheckpointError ? parseCheckpointWriteEvidence(error.checkpoint) : null;
}

export type RunProgressRetryOptions = {
  guardedRun?: GuardedRun;
  timeoutMs?: number;
  delayMs?: number;
  maxRecoveryWindowMs?: number;
  maxRetryAttemptMs?: number;
  now?: () => number;
};

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function withHttpStatus(error: unknown, status: number | undefined): unknown {
  if (status === undefined) return error;
  if (error instanceof Error) {
    const wrapped = new Error(error.message, { cause: error });
    wrapped.name = error.name;
    const value = error as Error & { code?: unknown; details?: unknown; hint?: unknown };
    if (typeof value.code === "string") Object.assign(wrapped, { code: value.code });
    if (typeof value.details === "string") Object.assign(wrapped, { details: value.details });
    if (typeof value.hint === "string") Object.assign(wrapped, { hint: value.hint });
    return Object.assign(wrapped, { status });
  }
  if (error !== null && typeof error === "object" && !Array.isArray(error)) {
    return { ...(error as Record<string, unknown>), status };
  }
  return { message: typeof error === "string" ? error : "Database request failed", status };
}

async function updateProgress(
  supabase: ProgressClient,
  runId: string,
  payload: ProgressPayload,
  signal?: AbortSignal,
  observer?: ProgressObserver,
): Promise<ProgressResponse> {
  signal?.throwIfAborted();
  let query = supabase
    .from("automation_runs")
    .update(payload)
    .eq("id", runId)
    .eq("status", "running");
  if (signal) query = query.abortSignal(signal);
  if (observer) observer.requests += 1;
  try {
    const response = await query as ProgressResponse;
    if (observer) {
      observer.response = response;
      observer.transportFailed = response.status === 0;
    }
    return response;
  } catch (error) {
    if (observer) observer.transportFailed = true;
    throw error;
  }
}

/**
 * Save one immutable run-progress snapshot. A 504 can mean that PostgREST
 * committed the PATCH before its gateway timed out, so the exact same fenced
 * update is safe to replay once. Inserts, RPCs, and completion writes stay out
 * of this boundary.
 */
export async function persistRunProgress(
  supabase: ProgressClient,
  runId: string,
  payload: ProgressPayload,
  options: RunProgressRetryOptions = {},
): Promise<void> {
  const controller = new AbortController();
  const observer: ProgressObserver = { requests: 0, response: null, transportFailed: false };
  const io: ScannerIoObservation = { requests: 0, headersAfterMs: null, bodyAfterMs: null, responseBytes: null };
  const startedAt = performance.now();
  const timeoutMs = Math.max(1, options.timeoutMs ?? PROGRESS_RECOVERY_WINDOW_MS);
  const evidence = (reason: CheckpointWriteEvidence["reason"]): CheckpointWriteEvidence => {
    const error = observer.response?.error;
    const code = error && typeof error === "object" ? (error as Record<string, unknown>).code : null;
    const status = observer.response?.status && observer.response.status >= 100 ? observer.response.status : io.httpStatus;
    return { reason, elapsedMs: Math.min(180_000, Math.max(0, Math.floor(performance.now() - startedAt))),
      timeoutMs: Math.min(180_000, Math.floor(timeoutMs)), requests: Math.min(2, Math.max(observer.requests, io.requests)),
      httpStatus: typeof status === "number" && status >= 100 && status <= 599 ? status : null,
      databaseCode: ["PGRST003", "57014", "42501", "55P03", "55000"].includes(String(code)) ? code as CheckpointWriteEvidence["databaseCode"] : null,
      ...(io.requests ? { requestPhase: io.headersAfterMs === null ? "headers" as const : io.bodyAfterMs === null ? "body" as const : "response" as const,
        headersAfterMs: io.headersAfterMs, bodyAfterMs: io.bodyAfterMs,
        responseBytes: io.responseBytes === null ? null : Math.min(1_048_576, io.responseBytes),
        payloadBytes: Math.min(1_048_576, new TextEncoder().encode(JSON.stringify(payload)).byteLength) } : {}) };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new ProgressCheckpointError(new Error("Scanner progress checkpoint timed out"), evidence("local_deadline"));
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    const write = withScannerIoObservation(io, () => options.guardedRun ? (async () => {
      let ack: Record<string, unknown>;
      try { ack = await guardedProgress(supabase, options.guardedRun!, structuredClone(payload), controller.signal, () => observer.requests++); }
      catch (error) {
        const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
        observer.response = { error, status };
        observer.transportFailed = status === 0;
        throw error;
      }
      observer.response = { error: null, status: Number(ack.httpStatus) };
      if (ack.status !== "applied" && ack.status !== "superseded") throw new Error("Scanner progress write fenced");
    })() : persistProgress(supabase, runId, payload, options, controller.signal, observer));
    await Promise.race([write, deadline]);
  } catch (error) {
    console.error(JSON.stringify({ event: "scanner_checkpoint_failed", id: runId,
      stage: payload.progress.stage, payloadBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
      evidence: error instanceof ProgressCheckpointError ? error.checkpoint : evidence(observer.transportFailed ? "transport_error" : "response_error") }));
    if (error instanceof ProgressCheckpointError) throw error;
    throw new ProgressCheckpointError(error, evidence(observer.transportFailed ? "transport_error" : "response_error"));
  } finally {
    clearTimeout(timer);
  }
}

async function persistProgress(
  supabase: ProgressClient,
  runId: string,
  payload: ProgressPayload,
  options: RunProgressRetryOptions,
  signal?: AbortSignal,
  observer?: ProgressObserver,
): Promise<void> {
  const stablePayload = structuredClone(payload);
  const delayMs = Math.max(0, options.delayMs ?? PROGRESS_RETRY_DELAY_MS);
  const recoveryWindowMs = Math.max(0, options.maxRecoveryWindowMs ?? PROGRESS_RECOVERY_WINDOW_MS);
  const retryAttemptMs = Math.max(1, options.maxRetryAttemptMs ?? PROGRESS_RETRY_ATTEMPT_MS);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const first = await updateProgress(supabase, runId, stablePayload, signal, observer);
  signal?.throwIfAborted();
  if (!first.error) return;
  if (first.status !== PROGRESS_RETRY_STATUS) throw withHttpStatus(first.error, first.status);

  const reportRecovery = (outcome: "recovered" | "failed" | "window_elapsed", status?: number) => {
    console.info(JSON.stringify({ event: "scanner_progress_recovery", id: runId,
      stage: stablePayload.progress.stage, outcome, initialStatus: first.status, status,
      elapsedMs: now() - startedAt }));
  };
  const remainingMs = recoveryWindowMs - (now() - startedAt);
  if (remainingMs <= delayMs) {
    reportRecovery("window_elapsed");
    throw withHttpStatus(first.error, first.status);
  }
  await wait(delayMs);
  signal?.throwIfAborted();

  const retryRemainingMs = recoveryWindowMs - (now() - startedAt);
  if (retryRemainingMs <= 0) {
    reportRecovery("window_elapsed");
    throw withHttpStatus(first.error, first.status);
  }
  const timeoutMs = Math.max(1, Math.floor(Math.min(retryAttemptMs, retryRemainingMs)));
  const retrySignal = AbortSignal.timeout(timeoutMs);
  let retry: ProgressResponse;
  try {
    retry = await updateProgress(supabase, runId, stablePayload, signal ? AbortSignal.any([signal, retrySignal]) : retrySignal, observer);
  } catch {
    reportRecovery("failed", 0);
    throw withHttpStatus(first.error, first.status);
  }
  reportRecovery(retry.error ? "failed" : "recovered", retry.status);
  if (!retry.error) return;
  // A transport/abort failure after the 504 leaves the original gateway error
  // as the most useful and stable diagnostic for the caller.
  if (retry.status === 0) throw withHttpStatus(first.error, first.status);
  throw withHttpStatus(retry.error, retry.status);
}
