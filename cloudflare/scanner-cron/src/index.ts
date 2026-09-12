import {
  SCANNER_ATTEMPT_HEADER, SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY,
  describeScannerDiagnostic, nextHourlyScannerWake, normalizeScannerTimestamp, parseScannerAttempt,
  parseScannerExecutionState,
  type ScannerAttempt, type ScannerAttemptStart, type ScannerDiagnostic,
  type ScannerExecutionState, type ScannerOutcome,
} from "../../../src/lib/automation/diagnostics";

export interface Env {
  CRON_URL: string;
  CRON_SECRET: string;
  ALERT_EMAIL?: { send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown> };
  ALERT_STATE?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  ALERT_SENDER?: string;
  ALERT_RECIPIENT?: string;
}

type CronController = { cron: string; scheduledTime: number; noRetry(): void };
type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type AiHealth = {
  state: "healthy" | "unavailable" | "limited" | "idle";
  code: string | null;
  message: string;
  lastSuccessAt: string | null;
};
type CronResult = { health: AiHealth | null; attempt: ScannerAttempt };
type AlertState = { incidentCode: string | null };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ALERT_STATE_KEY = "scanner-ai-health-alert-v1";
export const CRON_TIMEOUT_MS = 310_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const SAFE_CODE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const EMAIL = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

class CronIncident extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CronIncident";
  }
}

function safeAiCode(health: AiHealth): string {
  return health.code && SAFE_CODE.test(health.code) ? health.code : `ai_${health.state}`;
}

function safeTimestamp(value: string | null): string {
  return normalizeScannerTimestamp(value) ?? "Not available in the saved trigger record";
}

function parseCronResult(payload: unknown, start: ScannerAttemptStart, httpStatus: number): CronResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CronIncident("cron_response_invalid");
  const record = payload as Record<string, unknown>;
  const suppliedAttempt = record.attempt === undefined ? null : parseScannerAttempt(record.attempt);
  if (record.attempt !== undefined && (!suppliedAttempt || suppliedAttempt.id !== start.id)) throw new CronIncident("cron_response_invalid");
  if (record.ok !== true && !suppliedAttempt) throw new CronIncident("cron_payload_failed");
  const automation = record.automation;
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) throw new CronIncident("cron_response_invalid");
  const automationStatus = (automation as Record<string, unknown>).status;
  if (typeof automationStatus !== "string" || !["success", "partial", "failed", "skipped", "running"].includes(automationStatus)) {
    throw new CronIncident("cron_response_invalid");
  }
  const automationRecord = automation as Record<string, unknown>;
  if (automationRecord.errors !== undefined && !Array.isArray(automationRecord.errors)) throw new CronIncident("cron_response_invalid");
  let errorCount = Array.isArray(automationRecord.errors) ? automationRecord.errors.length : 0;
  const skips = Array.isArray(automationRecord.skips) ? automationRecord.skips : [];
  const diagnostic: ScannerDiagnostic | null = skips.includes("budget_read_failed")
    ? { stage: "budget_read", code: "database_unavailable" }
    : skips.includes("current_patch_unavailable") ? { stage: "patch_read", code: "current_patch_unavailable" } : null;
  const outcome: ScannerOutcome = automationStatus === "skipped" && (errorCount > 0 || diagnostic)
    ? "failed" : automationStatus === "success" && errorCount > 0 ? "partial" : automationStatus as ScannerOutcome;
  if (suppliedAttempt && (suppliedAttempt.outcome !== outcome ||
    ((record.ok !== true || httpStatus >= 400) && !["failed", "partial"].includes(suppliedAttempt.outcome)))) throw new CronIncident("cron_response_invalid");
  if (outcome === "failed" || outcome === "partial") errorCount = Math.max(1, errorCount);
  const attempt: ScannerAttempt = suppliedAttempt
    ? { ...suppliedAttempt, ...start, finishedAt: new Date().toISOString(), httpStatus }
    : { ...start, finishedAt: new Date().toISOString(), outcome, errorCount,
      diagnostics: diagnostic ? [diagnostic] : errorCount > 0 ? [{ stage: "scan", code: "operation_failed" }] : [],
      skipReason: automationRecord.reason === "paused" || automationRecord.reason === "recent_run" || automationRecord.reason === "scan_already_running"
        ? automationRecord.reason : null, nextEligibleAt: null, httpStatus };
  const health = record.aiHealth;
  if (health === null && suppliedAttempt && ["failed", "partial"].includes(attempt.outcome)) return { health: null, attempt };
  if (!health || typeof health !== "object" || Array.isArray(health)) throw new CronIncident("cron_response_invalid");
  const value = health as Record<string, unknown>;
  if (
    typeof value.state !== "string" || !["healthy", "unavailable", "limited", "idle"].includes(value.state) ||
    !(value.code === null || typeof value.code === "string") ||
    typeof value.message !== "string" ||
    !(value.lastSuccessAt === null || typeof value.lastSuccessAt === "string")
  ) throw new CronIncident("cron_response_invalid");
  return { health: value as AiHealth, attempt };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new CronIncident("cron_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CronIncident("cron_response_invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function requestCron(env: Env, fetchImpl: Fetch, timeoutMs: number, start: ScannerAttemptStart): Promise<CronResult> {
  const url = env.CRON_URL?.trim();
  const secret = env.CRON_SECRET?.trim();
  if (!url || !secret) throw new CronIncident("cron_configuration_missing");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let receivedResponse = false;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}`, "user-agent": "crimson-report-hub-cloudflare-cron", [SCANNER_ATTEMPT_HEADER]: start.id },
      redirect: "error",
      signal: abort.signal,
    });
    receivedResponse = true;
    if (!response.ok) {
      try {
        const result = parseCronResult(await readBoundedJson(response), start, response.status);
        if (result.attempt.outcome === "failed" || result.attempt.outcome === "partial") return result;
      } catch {
        if (abort.signal.aborted) throw new CronIncident("cron_timeout");
      }
      throw new CronIncident(`cron_http_${response.status}`);
    }
    return parseCronResult(await readBoundedJson(response), start, response.status);
  } catch (error) {
    if (abort.signal.aborted) throw new CronIncident("cron_timeout");
    if (error instanceof CronIncident) throw error;
    throw new CronIncident(receivedResponse ? "cron_response_invalid" : "cron_transport_error");
  } finally {
    clearTimeout(timer);
  }
}

function alertBindings(env: Env) {
  const email = env.ALERT_EMAIL;
  const state = env.ALERT_STATE;
  const sender = env.ALERT_SENDER?.trim();
  const recipient = env.ALERT_RECIPIENT?.trim();
  if (!email && !state && !sender && !recipient) return null;
  if (!email || !state || typeof sender !== "string" || typeof recipient !== "string" || !EMAIL.test(sender) || !EMAIL.test(recipient)) {
    throw new CronIncident("alert_configuration_invalid");
  }
  return { email, state, sender, recipient };
}

async function readAlertState(state: NonNullable<Env["ALERT_STATE"]>): Promise<AlertState> {
  try {
    const raw = await state.get(ALERT_STATE_KEY);
    if (raw === null) return { incidentCode: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CronIncident("alert_state_unavailable");
    const incidentCode = (parsed as Record<string, unknown>).incidentCode;
    if (incidentCode !== null && (typeof incidentCode !== "string" || !SAFE_CODE.test(incidentCode))) {
      throw new CronIncident("alert_state_unavailable");
    }
    return { incidentCode };
  } catch {
    throw new CronIncident("alert_state_unavailable");
  }
}

async function writeAlertState(state: NonNullable<Env["ALERT_STATE"]>, incidentCode: string | null): Promise<void> {
  try {
    await state.put(ALERT_STATE_KEY, JSON.stringify({ incidentCode } satisfies AlertState));
  } catch {
    throw new CronIncident("alert_state_unavailable");
  }
}

async function sendAlert(
  bindings: NonNullable<ReturnType<typeof alertBindings>>,
  kind: "incident" | "recovery",
  code: string,
  health?: AiHealth,
  snapshot?: ScannerExecutionState,
): Promise<void> {
  const subject = kind === "incident" ? `[CD Report Hub] Scanner AI alert: ${code}` : `[CD Report Hub] Scanner AI recovered: ${code}`;
  const attempt = snapshot?.latestAttempt;
  const text = [
    kind === "incident" ? "The scanner needs attention." : "The scanner recovered after a successful scan.",
    `${kind === "incident" ? "Code" : "Previous code"}: ${code}`,
    ...(attempt ? [`Attempt: ${attempt.id}`, `Started: ${attempt.startedAt}`, `Outcome: ${attempt.outcome}`,
      ...attempt.diagnostics.map(describeScannerDiagnostic),
      ...(attempt.httpStatus ? [`HTTP status: ${attempt.httpStatus}`] : [])] : []),
    `Last successful scan: ${safeTimestamp(snapshot?.lastSuccessfulScanAt ?? null)}`,
    `Last successful AI processing: ${safeTimestamp(snapshot?.lastSuccessfulAiAt ?? health?.lastSuccessAt ?? null)}`,
    `Next hourly wake: ${nextHourlyScannerWake(new Date())}`,
    ...(attempt?.nextEligibleAt ? [`Next eligible scan: ${attempt.nextEligibleAt}`] : []),
    ...(!health ? ["The failed request did not supply AI health details; this does not erase earlier successes."] : []),
    "Review the operator console and private runtime logs using the attempt ID.",
  ].join("\n");
  try {
    await bindings.email.send({ to: bindings.recipient, from: bindings.sender, subject, text });
  } catch {
    throw new CronIncident("alert_delivery_failed");
  }
}

async function reconcileAlert(env: Env, incidentCode: string | null, health?: AiHealth, snapshot?: ScannerExecutionState): Promise<void> {
  const bindings = alertBindings(env);
  if (!bindings) return;
  const stored = await readAlertState(bindings.state);
  if (incidentCode) {
    if (stored.incidentCode === incidentCode) return;
    await sendAlert(bindings, "incident", incidentCode, health, snapshot);
    await writeAlertState(bindings.state, incidentCode);
    return;
  }
  if (!stored.incidentCode || health?.state === "idle") return;
  await sendAlert(bindings, "recovery", stored.incidentCode, health, snapshot);
  await writeAlertState(bindings.state, null);
}

export async function runCron(env: Env, fetchImpl: Fetch = fetch, timeoutMs = CRON_TIMEOUT_MS): Promise<void> {
  const start: ScannerAttemptStart = { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
  let previous: ScannerExecutionState | null = null;
  const statusFailures: CronIncident[] = [];
  let statusReadable = true;
  if (env.ALERT_STATE) {
    try {
      const raw = await env.ALERT_STATE.get(SCANNER_EXECUTION_STATE_KEY);
      previous = raw === null ? null : parseScannerExecutionState(JSON.parse(raw));
      if (raw !== null && (!previous || Date.parse(previous.latestAttempt.finishedAt) > Date.now() + 60_000)) throw new Error("invalid state");
    } catch {
      statusReadable = false;
      statusFailures.push(new CronIncident("scanner_status_read_failed"));
    }
    try {
      // A separate key avoids KV's one-write-per-second limit for fast skips.
      await env.ALERT_STATE.put(SCANNER_ATTEMPT_START_KEY, JSON.stringify(start));
    } catch {
      statusFailures.push(new CronIncident("scanner_status_write_failed"));
    }
  }
  console.info(JSON.stringify({ event: "scanner_attempt_started", ...start }));
  let result: CronResult;
  let incident: CronIncident | null = null;
  try {
    result = await requestCron(env, fetchImpl, timeoutMs, start);
  } catch (error) {
    incident = error instanceof CronIncident ? error : new CronIncident("cron_transport_error");
    const status = /^cron_http_(\d{3})$/.exec(incident.code);
    result = { health: null, attempt: { ...start, finishedAt: new Date().toISOString(), outcome: "failed", errorCount: 1,
      skipReason: null, nextEligibleAt: null, httpStatus: status ? Number(status[1]) : null,
      diagnostics: [{ stage: "request", code: incident.code === "cron_configuration_missing" ? "configuration_missing" : incident.code === "cron_timeout" ? "request_timeout"
        : incident.code === "cron_transport_error" ? "transport_error" : status ? "http_error" : "response_invalid" }] } };
  }
  const { health, attempt } = result;
  if (!incident && (attempt.outcome === "failed" || attempt.outcome === "partial")) {
    incident = new CronIncident(`scanner_run_${attempt.outcome}`);
  }
  if (!incident && health && (health.state === "limited" || health.state === "unavailable")) {
    incident = new CronIncident(safeAiCode(health));
  }
  const recordStatusFailure = (failure: CronIncident) => {
    const diagnostic: ScannerDiagnostic = { stage: failure.code === "scanner_status_read_failed" ? "status_read" : "status_write", code: "operation_failed" };
    attempt.diagnostics = [...attempt.diagnostics.filter((item) => item.stage !== diagnostic.stage), diagnostic].slice(-16);
    if (attempt.outcome !== "failed") attempt.outcome = "partial";
    attempt.errorCount++;
  };
  for (const failure of statusFailures) recordStatusFailure(failure);
  const currentAi = normalizeScannerTimestamp(health?.lastSuccessAt);
  const lastAi = currentAi && Date.parse(currentAi) <= Date.parse(attempt.finishedAt)
    ? currentAi : previous?.lastSuccessfulAiAt ?? null;
  const snapshot: ScannerExecutionState = {
    version: 1, latestAttempt: attempt,
    lastSuccessfulScanAt: attempt.outcome === "success" ? attempt.finishedAt : previous?.lastSuccessfulScanAt ?? null,
    lastSuccessfulAiAt: previous?.lastSuccessfulAiAt && lastAi && Date.parse(previous.lastSuccessfulAiAt) > Date.parse(lastAi) ? previous.lastSuccessfulAiAt : lastAi,
    lastFailedAttempt: attempt.outcome === "failed" || attempt.outcome === "partial" ? attempt : previous?.lastFailedAttempt ?? null,
  };
  if (env.ALERT_STATE && statusReadable) {
    try { await env.ALERT_STATE.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(snapshot)); }
    catch {
      const failure = new CronIncident("scanner_status_write_failed");
      statusFailures.push(failure);
      recordStatusFailure(failure);
      snapshot.lastFailedAttempt = attempt;
    }
  }
  console.info(JSON.stringify({ event: "scanner_attempt_completed", ...snapshot,
    monitoringFailures: statusFailures.map((failure) => failure.code) }));
  const finalIncident = incident ?? statusFailures[0];
  const alertHealth = health && (attempt.outcome === "skipped" || attempt.outcome === "running" || health.state === "idle")
    ? { ...health, state: "idle" as const } : health;
  await reconcileAlert(env, finalIncident?.code ?? null, alertHealth ?? undefined, snapshot);
  if (finalIncident) throw finalIncident;
}

const worker = {
  async scheduled(_controller: CronController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};

export default worker;
