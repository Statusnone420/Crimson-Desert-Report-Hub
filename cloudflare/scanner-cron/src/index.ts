import {
  SCANNER_ATTEMPT_HEADER, SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY,
  describeScannerDiagnostic, normalizeScannerTimestamp, parseScannerAttempt, scannerDiagnosticAction,
  parseScannerExecutionState,
  parseScannerAlertDelivery,
  safeScannerAiIncidentCode,
  scannerAttemptId,
  type ScannerAttempt, type ScannerAttemptStart, type ScannerDiagnostic,
  type ScannerExecutionState, type ScannerOutcome, type ScannerAlertDelivery,
} from "../../../src/lib/automation/diagnostics";
import { parseScannerAiEvidence, type ScannerAiEvidence } from "../../../src/lib/automation/openRouterReadout";
import { scannerAiFailureMessage, type ScannerAiHealth } from "../../../src/lib/automation/health";
export { ScannerCoordinator } from "./coordinator";

export interface Env {
  CRON_URL: string;
  CRON_SECRET: string;
  ALERT_EMAIL?: { send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown> };
  ALERT_STATE?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  ALERT_SENDER?: string;
  ALERT_RECIPIENT?: string;
  SCANNER_COORDINATOR?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
}

type CronController = { cron: string; scheduledTime: number; noRetry(): void };
type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type AiHealth = ScannerAiHealth;
type CronResult = { health: AiHealth | null; attempt: ScannerAttempt; aiEvidence?: ScannerAiEvidence | null };
export type AlertDelivery = ScannerAlertDelivery;
/** A first sighting that waits for the next completed scan before any email. */
type PendingIncident = { code: string; attemptId: string };
type AlertState = { incidentCode: string | null; delivery?: AlertDelivery; pending?: PendingIncident };
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
  if (health.code === "workers_ai_daily_limit") return "workers_ai_daily_limit";
  return safeScannerAiIncidentCode(health.code, health.state === "unavailable" ? "unavailable" : "limited");
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
  if (automationRecord.persistence !== undefined && !["recorded", "unconfirmed"].includes(String(automationRecord.persistence))) throw new CronIncident("cron_response_invalid");
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
      ...(automationRecord.persistence ? { persistence: automationRecord.persistence as ScannerAttempt["persistence"] } : {}),
      skipReason: automationRecord.reason === "paused" || automationRecord.reason === "recent_run" || automationRecord.reason === "scan_already_running"
        ? automationRecord.reason : null, nextEligibleAt: null, httpStatus };
  const health = record.aiHealth;
  const aiEvidence = record.aiEvidence == null ? null : parseScannerAiEvidence(record.aiEvidence);
  if (record.aiEvidence != null && !aiEvidence) throw new CronIncident("cron_response_invalid");
  if (health === null && suppliedAttempt && ["failed", "partial"].includes(attempt.outcome)) return { health: null, attempt, aiEvidence };
  if (!health || typeof health !== "object" || Array.isArray(health)) throw new CronIncident("cron_response_invalid");
  const value = health as Record<string, unknown>;
  if (
    typeof value.state !== "string" || !["healthy", "unavailable", "limited", "idle"].includes(value.state) ||
    !(value.code === null || typeof value.code === "string") ||
    typeof value.message !== "string" ||
    !(value.lastSuccessAt === null || typeof value.lastSuccessAt === "string")
    || value.currentSpending !== undefined && (typeof value.currentSpending !== "string" ||
      !["within_limits", "month_limit", "month_paused", "blocked", "disabled", "unverified"].includes(value.currentSpending))
  ) throw new CronIncident("cron_response_invalid");
  return { health: value as AiHealth, attempt, aiEvidence };
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
      // workerd rejects "error" before sending. Keep redirects visible without forwarding the bearer token.
      redirect: "manual",
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
    const delivery = parseAlertDelivery((parsed as Record<string, unknown>).delivery);
    if ((parsed as Record<string, unknown>).delivery !== undefined && !delivery) throw new CronIncident("alert_state_unavailable");
    const rawPending = (parsed as Record<string, unknown>).pending;
    const pending = rawPending && typeof rawPending === "object" && !Array.isArray(rawPending) &&
      typeof (rawPending as PendingIncident).code === "string" && SAFE_CODE.test((rawPending as PendingIncident).code) &&
      scannerAttemptId((rawPending as PendingIncident).attemptId)
      ? { code: (rawPending as PendingIncident).code, attemptId: (rawPending as PendingIncident).attemptId } : null;
    if (rawPending !== undefined && !pending) throw new CronIncident("alert_state_unavailable");
    return { incidentCode, ...(delivery ? { delivery } : {}), ...(pending ? { pending } : {}) };
  } catch {
    throw new CronIncident("alert_state_unavailable");
  }
}

export function parseAlertDelivery(value: unknown): AlertDelivery | null {
  return parseScannerAlertDelivery(value);
}

async function writeAlertState(state: NonNullable<Env["ALERT_STATE"]>, incidentCode: string | null, delivery: AlertDelivery): Promise<void> {
  try {
    await state.put(`scanner-alert-delivery-${delivery.id}`, JSON.stringify(delivery));
    await state.put(ALERT_STATE_KEY, JSON.stringify({ incidentCode, delivery } satisfies AlertState));
  } catch {
    throw new CronIncident("alert_state_unavailable");
  }
}

async function writePendingState(state: NonNullable<Env["ALERT_STATE"]>, stored: AlertState, pending: PendingIncident | null): Promise<void> {
  try {
    await state.put(ALERT_STATE_KEY, JSON.stringify({ incidentCode: stored.incidentCode,
      ...(stored.delivery ? { delivery: stored.delivery } : {}), ...(pending ? { pending } : {}) } satisfies AlertState));
  } catch {
    throw new CronIncident("alert_state_unavailable");
  }
}

/** Money problems and already-confirmed warnings email at once; others wait for a second completed scan. */
const IMMEDIATE_ALERT = /unexpected_charge|budget_exceeded|^scanner_completed_warning$/;

async function sendAlert(
  bindings: NonNullable<ReturnType<typeof alertBindings>>,
  kind: "incident" | "recovery",
  code: string,
  health?: AiHealth,
  snapshot?: ScannerExecutionState,
): Promise<void> {
  const warning = code === "scanner_completed_warning";
  const subject = kind === "recovery" ? `[CD Report Hub] Scanner recovered: ${code}` : warning
    ? "[CD Report Hub] Scanner saved; repeated reporting warnings" : `[CD Report Hub] Scanner needs attention: ${code}`;
  const attempt = snapshot?.latestAttempt;
  const money = IMMEDIATE_ALERT.test(code) && !warning;
  const monthlyPause = money && ["month_limit", "month_paused"].includes(health?.currentSpending ?? "");
  // Fixed text only: never upstream messages, URLs from sources, or exception text.
  const text = [
    kind === "recovery" ? "A later scan completed successfully. No action needed. The original failure receipt is retained." : warning
      ? "The scan and spending record were saved. Optional progress reporting has warned on two consecutive completed scans."
      : attempt?.persistence === "unconfirmed" ? "The completed run save is unconfirmed. Its reserved spending remains counted."
      : money ? "A charge check failed, so paid AI work stopped."
      : "The problem was still present on the next completed scan. Paid work stays within its accounting limits.",
    ...(kind === "incident" ? [
      ...(attempt?.diagnostics.length ? attempt.diagnostics.slice(0, 2).map(describeScannerDiagnostic) : [code === "openrouter_cost_unverified"
        ? "AI completion or billing is unconfirmed. Reserved spending remains counted." : scannerAiFailureMessage(code) ?? `Reason: ${code}`]),
      monthlyPause ? "Owner action: AI stays paused this month. Ask an agent to check the charge before changing settings."
        : money ? "Owner action: check the charge from the affected run. Current month-long blocking is not established by this incident receipt."
        : "Owner action: none yet. An agent can diagnose this from the details below.",
      "For agents:",
      `- Runbook: docs/scanner-alerts.md (find ${code})`,
      ...(attempt ? [`- Supabase: select status, skips, progress from automation_runs where id = '${attempt.id}';`,
        "- No row means the failure happened before the run was saved; see the Worker log for this attempt ID."] : []),
      warning ? "- Inspect the retained checkpoint timing before changing scanner logic."
        : attempt?.diagnostics[0] ? `- ${scannerDiagnosticAction(attempt.diagnostics[0])}` : "- Inspect the saved receipt and accounting state before any retry."] : []),
    `Code: ${code}`,
    `Last successful scan: ${snapshot?.lastSuccessfulScanAt ?? "Not available in the saved trigger record"}`,
    ...(attempt?.httpStatus ? [`HTTP status: ${attempt.httpStatus}`] : []),
    ...(attempt ? [`Attempt: ${attempt.id}`] : []),
    "Receipt: https://crimsonreporthub.com/operator?view=scanner#health",
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
  const attempt = snapshot?.latestAttempt;
  const completed = attempt !== undefined && attempt.outcome !== "skipped" && attempt.outcome !== "running";
  if (!stored.incidentCode) {
    // Most problems clear on the next scan. Before any email, wait for the next
    // completed scan to show a problem too. Skipped and running wakes do not count.
    if (incidentCode && !IMMEDIATE_ALERT.test(incidentCode)) {
      if (!completed) return;
      if (!stored.pending) return writePendingState(bindings.state, stored, { code: incidentCode, attemptId: attempt.id });
      if (stored.pending.attemptId === attempt.id) return;
    } else if (!incidentCode && stored.pending) {
      if (completed) await writePendingState(bindings.state, stored, null);
      return;
    }
  }
  // An unrelated execution receipt cannot establish recovery of the provider
  // incident retained by alert severity deduplication.
  const storedExecutionIncident = stored.incidentCode === "scanner_completed_warning"
    || stored.incidentCode === "cron_configuration_missing" || stored.incidentCode === "scanner_request_configuration_missing"
    || /^scanner_(database_check|policy_read|schedule_read|patch_read|budget_read)_/.test(stored.incidentCode ?? "");
  const recoveredWithoutAi = health?.state === "idle" && storedExecutionIncident
    && snapshot?.latestAttempt.outcome === "success" && snapshot.latestAttempt.persistence === "recorded"
    && snapshot.lastFailureReceipt?.recoveredAt != null && snapshot.lastFailureReceipt.canRecoverWithoutAi === true;
  if (!incidentCode && hasAiRecoveryAmbiguity(health, snapshot?.latestAiEvidence)) return;
  if (incidentCode ? stored.incidentCode === incidentCode : !stored.incidentCode || health?.state !== "healthy" && !recoveredWithoutAi) return;
  const severity = (code: string) => code === "scanner_completed_warning" ? 1 :
    /paid_accounting|run_finalize|cost_unverified|unexpected_charge|budget_exceeded/.test(code) ? 3 : 2;
  // A changed technical code within an unresolved incident is retained in the
  // receipt. Email again only for a higher impact, then once on recovery.
  if (incidentCode && stored.incidentCode && severity(incidentCode) <= severity(stored.incidentCode)) return;
  const delivery: AlertDelivery = { id: crypto.randomUUID(), code: incidentCode ?? stored.incidentCode!,
    episodeId: stored.incidentCode ? stored.delivery?.episodeId ?? crypto.randomUUID() : crypto.randomUUID(),
    kind: incidentCode ? "incident" : "recovery", state: "dispatching", at: new Date().toISOString() };
  // Reserve before dispatch in the coordinator's strongly consistent storage.
  // A crash/timeout after this point is an unknown delivery, never a retry.
  await writeAlertState(bindings.state, incidentCode, delivery);
  try {
    await boundedNotification(() => sendAlert(bindings, delivery.kind, delivery.code, health, snapshot));
    delivery.state = "sent";
    await writeAlertState(bindings.state, incidentCode, delivery);
  } catch (error) {
    delivery.state = "unknown";
    await writeAlertState(bindings.state, incidentCode, delivery);
    throw error;
  }
}

export async function boundedNotification<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CronIncident("alert_delivery_failed")), 10_000);
  })]); } finally { clearTimeout(timer); }
}

function hasAiRecoveryAmbiguity(health: AiHealth | null | undefined, evidence: ScannerAiEvidence | null | undefined,
  reportingOnly = false): boolean {
  const attempted = evidence?.attemptedCalls ?? 0;
  return Boolean((health?.state === "unavailable" || health?.state === "limited")
    && !(reportingOnly && health.code === "ai_history_unavailable") || evidence &&
    (evidence.lastProblem || evidence.costState === "reserved_unknown" || evidence.costState === "unknown" || attempted > 0
      && ((evidence.validatedCalls ?? 0) < attempted || evidence.costState !== "verified")));
}

function executionOnlyFailure(attempt: ScannerAttempt, health: AiHealth | null, evidence: ScannerAiEvidence | null | undefined): boolean {
  if (hasAiRecoveryAmbiguity(health, evidence) || (evidence?.attemptedCalls ?? 0) > 0) return false;
  // These stages precede paid dispatch. Transport/timeouts after a
  // trigger was sent, run creation and finalization can hide paid work.
  return attempt.diagnostics.length > 0 && attempt.diagnostics.every(item =>
    ["database_check", "policy_read", "schedule_read", "patch_read", "budget_read"].includes(item.stage)
      || item.stage === "request" && item.code === "configuration_missing");
}

export async function runCron(env: Env, fetchImpl: Fetch = fetch, timeoutMs = CRON_TIMEOUT_MS,
  options?: { start: ScannerAttemptStart; executionState: NonNullable<Env["ALERT_STATE"]>; startMirrorFailed?: boolean }): Promise<void> {
  const start: ScannerAttemptStart = options?.start ?? { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
  const executionState = options?.executionState ?? env.ALERT_STATE;
  let previous: ScannerExecutionState | null = null;
  const statusFailures: CronIncident[] = [];
  if (options?.startMirrorFailed) statusFailures.push(new CronIncident("scanner_status_write_failed"));
  let statusReadable = true;
  if (executionState) {
    try {
      const raw = await executionState.get(SCANNER_EXECUTION_STATE_KEY);
      previous = raw === null ? null : parseScannerExecutionState(JSON.parse(raw));
      if (raw !== null && (!previous || Date.parse(previous.latestAttempt.finishedAt) > Date.now() + 60_000)) throw new Error("invalid state");
    } catch {
      statusReadable = false;
      statusFailures.push(new CronIncident("scanner_status_read_failed"));
    }
    try {
      // A separate key avoids KV's one-write-per-second limit for fast skips.
      await executionState.put(SCANNER_ATTEMPT_START_KEY, JSON.stringify(start));
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
  const completedWarning = attempt.warningOnly === true && attempt.persistence === "recorded";
  const aiRecoveryAmbiguous = hasAiRecoveryAmbiguity(health, result.aiEvidence, completedWarning);
  const consecutiveWarnings = completedWarning ? Math.min(1000, (previous?.consecutiveWarnings ?? 0) + 1)
    : attempt.outcome === "skipped" || attempt.outcome === "running" ? previous?.consecutiveWarnings ?? 0 : 0;
  if (!incident && (attempt.outcome === "failed" || attempt.outcome === "partial") && !completedWarning) {
    const failure = attempt.diagnostics.find((item) => !["progress_write", "retention", "health_read", "cache_revalidate", "mapping_cache"].includes(item.stage)) ?? attempt.diagnostics[0];
    incident = new CronIncident(failure ? `scanner_${failure.stage}_${failure.code}` : `scanner_run_${attempt.outcome}`);
  }
  // A paid-work stop applies to one scan. Health keeps it until a scan makes an AI
  // request, so a clean scan with current spending allowed does not repeat it.
  const earlierSpendingStop = health?.code === "spending_blocked" && health.currentSpending === "within_limits"
    && attempt.outcome === "success" && attempt.persistence === "recorded"
    && !attempt.diagnostics.some((item) => item.code === "spending_blocked");
  // A bad or failed AI answer belongs to the scan that asked. Health keeps it until a
  // scan makes an AI request, so a clean scan that made none cannot repeat it.
  const earlierAnswerProblem = (health?.code === "openrouter_invalid_json" || health?.code === "openrouter_provider_failure")
    && attempt.outcome === "success" && attempt.persistence === "recorded"
    && attempt.context?.workCounts.llmCallsUsed === 0;
  if (!incident && health && (health.state === "limited" || health.state === "unavailable") &&
    !(completedWarning && health.code === "ai_history_unavailable") && !earlierSpendingStop && !earlierAnswerProblem) {
    incident = new CronIncident(safeAiCode(health));
  }
  if (!incident && completedWarning && consecutiveWarnings >= 2) incident = new CronIncident("scanner_completed_warning");
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
  const aiIncidentCode = health && (health.state === "limited" || health.state === "unavailable")
    ? safeScannerAiIncidentCode(health.code, health.state) : null;
  // Health can describe an earlier run. An idle wake or an empty evidence
  // response must not replace the saved facts from that incident.
  const retainAiIncident = previous?.lastAiIncident &&
    (attempt.outcome === "skipped" || attempt.outcome === "running" ||
      (previous.lastAiIncident.code === aiIncidentCode && !result.aiEvidence?.lastProblem));
  const sameFailure = previous?.lastFailureReceipt?.attempt.persistence === attempt.persistence &&
    previous?.lastFailureReceipt?.attempt.diagnostics[0]?.stage === attempt.diagnostics[0]?.stage &&
    previous?.lastFailureReceipt?.attempt.diagnostics[0]?.code === attempt.diagnostics[0]?.code;
  const retainedEvidence = sameFailure && previous?.lastFailureReceipt?.recoveredAt === null
    && !result.aiEvidence?.lastProblem && !result.aiEvidence?.lastCheckpointWrite
    ? previous?.lastFailureReceipt?.evidence ?? result.aiEvidence ?? null : result.aiEvidence ?? null;
  const previousReceipt = previous?.lastFailureReceipt;
  const retainedAiRecoveryAmbiguous = previousReceipt?.recoveredAt === null
    && (hasAiRecoveryAmbiguity(null, previousReceipt.evidence) || hasAiRecoveryAmbiguity(null, previousReceipt.firstEvidence));
  const previousCanRecoverWithoutAi = !retainedAiRecoveryAmbiguous
    && (previousReceipt?.canRecoverWithoutAi ?? previousReceipt?.attempt.warningOnly === true);
  const snapshot: ScannerExecutionState = {
    version: 1, latestAttempt: attempt,
    lastSuccessfulScanAt: attempt.outcome === "success" && attempt.persistence === "recorded" || completedWarning
      ? attempt.finishedAt : previous?.lastSuccessfulScanAt ?? null,
    lastSuccessfulAiAt: previous?.lastSuccessfulAiAt && lastAi && Date.parse(previous.lastSuccessfulAiAt) > Date.parse(lastAi) ? previous.lastSuccessfulAiAt : lastAi,
    lastFailedAttempt: attempt.outcome === "failed" || attempt.outcome === "partial" ? attempt : previous?.lastFailedAttempt ?? null,
    consecutiveWarnings,
    lastFailureReceipt: attempt.outcome === "failed" || attempt.outcome === "partial"
      ? { attempt, evidence: retainedEvidence, recoveredAt: null,
        canRecoverWithoutAi: !aiRecoveryAmbiguous && (completedWarning && (!incident || incident.code === "scanner_completed_warning")
          || executionOnlyFailure(attempt, health, result.aiEvidence))
          && (!previous?.lastFailureReceipt || previous.lastFailureReceipt.recoveredAt !== null
          || previousCanRecoverWithoutAi),
        firstAttempt: previous?.lastFailureReceipt && !previous.lastFailureReceipt.recoveredAt
          ? previous.lastFailureReceipt.firstAttempt ?? previous.lastFailureReceipt.attempt : attempt,
        firstEvidence: previous?.lastFailureReceipt && !previous.lastFailureReceipt.recoveredAt
          ? previous.lastFailureReceipt.firstEvidence !== undefined
            ? previous.lastFailureReceipt.firstEvidence : previous.lastFailureReceipt.evidence : retainedEvidence }
      : previous?.lastFailureReceipt ? { ...previous.lastFailureReceipt,
        // A successful collection can still add an unresolved AI problem to
        // this episode without creating a new failed-attempt receipt.
        ...(!previous.lastFailureReceipt.recoveredAt ? { canRecoverWithoutAi: previousCanRecoverWithoutAi && !aiRecoveryAmbiguous } : {}),
        recoveredAt: !aiRecoveryAmbiguous && attempt.outcome === "success" && attempt.persistence === "recorded"
          && (health?.state === "healthy" || previousCanRecoverWithoutAi && health?.state === "idle")
          ? previous.lastFailureReceipt.recoveredAt ?? attempt.finishedAt : previous.lastFailureReceipt.recoveredAt } : null,
    ...(result.aiEvidence || previous?.latestAiEvidence !== undefined ? { latestAiEvidence: result.aiEvidence ?? null } : {}),
    ...(aiIncidentCode && !retainAiIncident
      ? { lastAiIncident: { attemptId: attempt.id, reportedAt: attempt.finishedAt,
        code: aiIncidentCode, evidence: result.aiEvidence ?? null } }
      : previous?.lastAiIncident !== undefined ? { lastAiIncident: previous.lastAiIncident } : {}),
  };
  if (executionState && statusReadable) {
    try { await executionState.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(snapshot)); }
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
  const alertHealth = health && (attempt.outcome === "skipped" || attempt.outcome === "running" ||
    attempt.outcome === "success" && attempt.persistence !== "recorded" || completedWarning && consecutiveWarnings < 2 || health.state === "idle")
    ? { ...health, state: "idle" as const } : health;
  await reconcileAlert(env, finalIncident?.code ?? null, alertHealth ?? undefined, snapshot);
  if (finalIncident) throw finalIncident;
}

const worker = {
  async scheduled(controller: CronController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    if (!env.SCANNER_COORDINATOR) throw new CronIncident("scanner_coordinator_unavailable");
    const object = env.SCANNER_COORDINATOR.get(env.SCANNER_COORDINATOR.idFromName("scanner-coordinator-v1"));
    ctx.waitUntil((async () => {
      const response = await object.fetch("https://scanner.internal/wake", { method: "POST",
        body: JSON.stringify({ wake: `${controller.scheduledTime}:${controller.cron}` }) });
      if (!response.ok) throw new CronIncident("scanner_coordinator_unavailable");
    })());
  },
};

export default worker;
