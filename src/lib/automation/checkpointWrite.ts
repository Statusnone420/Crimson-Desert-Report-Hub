/** Shared, private checkpoint facts. Never retain an upstream error object. */
export type CheckpointWriteEvidence = {
  reason: "local_deadline" | "response_error" | "transport_error";
  elapsedMs: number;
  timeoutMs: number;
  requests: number;
  httpStatus: number | null;
  databaseCode: "PGRST003" | "57014" | "42501" | "55P03" | "55000" | null;
  requestPhase?: "headers" | "body" | "response";
  headersAfterMs?: number | null;
  bodyAfterMs?: number | null;
  responseBytes?: number | null;
  payloadBytes?: number;
};

export type ScannerCheckpointFailure = CheckpointWriteEvidence & { runStage: "starting" | "searching" | "screening" | "persisting" | "done" };
export function parseScannerCheckpointFailure(value: unknown): ScannerCheckpointFailure | null {
  const evidence = parseCheckpointWriteEvidence(value);
  const stage = value && typeof value === "object" ? (value as Record<string, unknown>).runStage : null;
  return evidence && ["starting", "searching", "screening", "persisting", "done"].includes(String(stage))
    ? { ...evidence, runStage: stage as ScannerCheckpointFailure["runStage"] } : null;
}

const bounded = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;

export function parseCheckpointWriteEvidence(value: unknown): CheckpointWriteEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.reason !== "string" || !["local_deadline", "response_error", "transport_error"].includes(item.reason) ||
    !bounded(item.elapsedMs, 180_000) || !bounded(item.timeoutMs, 180_000) || item.timeoutMs < 1 ||
    !bounded(item.requests, 2) ||
    !(item.httpStatus === null || (bounded(item.httpStatus, 599) && item.httpStatus >= 100)) ||
    !(item.databaseCode === null || (typeof item.databaseCode === "string" && ["PGRST003", "57014", "42501", "55P03", "55000"].includes(item.databaseCode)))) return null;
  if (item.requestPhase !== undefined && !["headers", "body", "response"].includes(String(item.requestPhase))) return null;
  for (const key of ["headersAfterMs", "bodyAfterMs"] as const) {
    if (item[key] !== undefined && item[key] !== null && !bounded(item[key], 180_000)) return null;
  }
  if (item.responseBytes !== undefined && item.responseBytes !== null && !bounded(item.responseBytes, 1_048_576)) return null;
  if (item.payloadBytes !== undefined && !bounded(item.payloadBytes, 1_048_576)) return null;
  return { reason: item.reason as CheckpointWriteEvidence["reason"], elapsedMs: item.elapsedMs,
    timeoutMs: item.timeoutMs, requests: item.requests, httpStatus: item.httpStatus as number | null,
    databaseCode: item.databaseCode as CheckpointWriteEvidence["databaseCode"],
    ...(item.requestPhase !== undefined ? { requestPhase: item.requestPhase as CheckpointWriteEvidence["requestPhase"] } : {}),
    ...Object.fromEntries(["headersAfterMs", "bodyAfterMs", "responseBytes", "payloadBytes"].filter((key) => item[key] !== undefined).map((key) => [key, item[key]])) };
}

export function describeCheckpointWrite(evidence: CheckpointWriteEvidence): string {
  const reason = evidence.reason === "local_deadline" ? `app deadline expired (limit ${evidence.timeoutMs} ms)` :
    evidence.reason === "response_error" ? "database request returned an error" : "database request transport failed";
  return `${reason} · ${evidence.elapsedMs} ms observed · ${evidence.requests} database request${evidence.requests === 1 ? "" : "s"}${evidence.httpStatus === null ? " · no HTTP response status observed" : ` · last HTTP ${evidence.httpStatus}`}${evidence.databaseCode ? ` · ${evidence.databaseCode}` : ""}${evidence.requestPhase ? ` · stopped at ${evidence.requestPhase}` : ""}${evidence.headersAfterMs == null ? "" : ` · headers ${evidence.headersAfterMs} ms`}${evidence.bodyAfterMs == null ? "" : ` · body ${evidence.bodyAfterMs} ms`}`;
}
