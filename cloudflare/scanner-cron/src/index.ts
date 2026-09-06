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
type CronResult = { health: AiHealth; automationStatus: "success" | "partial" | "failed" | "skipped" | "running" };
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
  if (!value || value.length > 35) return "No successful AI run recorded";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "No successful AI run recorded";
}

function parseCronResult(payload: unknown): CronResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CronIncident("cron_response_invalid");
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) throw new CronIncident("cron_payload_failed");
  const automation = record.automation;
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) throw new CronIncident("cron_response_invalid");
  const automationStatus = (automation as Record<string, unknown>).status;
  if (!["success", "partial", "failed", "skipped", "running"].includes(String(automationStatus))) {
    throw new CronIncident("cron_response_invalid");
  }
  const health = record.aiHealth;
  if (!health || typeof health !== "object" || Array.isArray(health)) throw new CronIncident("cron_response_invalid");
  const value = health as Record<string, unknown>;
  if (
    !["healthy", "unavailable", "limited", "idle"].includes(String(value.state)) ||
    !(value.code === null || typeof value.code === "string") ||
    typeof value.message !== "string" ||
    !(value.lastSuccessAt === null || typeof value.lastSuccessAt === "string")
  ) throw new CronIncident("cron_response_invalid");
  return { health: value as AiHealth, automationStatus: automationStatus as CronResult["automationStatus"] };
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
      if (length > MAX_RESPONSE_BYTES) throw new CronIncident("cron_response_invalid");
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

async function requestCron(env: Env, fetchImpl: Fetch, timeoutMs: number): Promise<CronResult> {
  const url = env.CRON_URL?.trim();
  const secret = env.CRON_SECRET?.trim();
  if (!url || !secret) throw new CronIncident("cron_configuration_missing");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let receivedResponse = false;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}`, "user-agent": "crimson-report-hub-cloudflare-cron" },
      signal: abort.signal,
    });
    receivedResponse = true;
    if (!response.ok) throw new CronIncident(`cron_http_${response.status}`);
    return parseCronResult(await readBoundedJson(response));
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
    if (!raw) return { incidentCode: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { incidentCode: null };
    const incidentCode = (parsed as Record<string, unknown>).incidentCode;
    return { incidentCode: typeof incidentCode === "string" && SAFE_CODE.test(incidentCode) ? incidentCode : null };
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
): Promise<void> {
  const subject = kind === "incident" ? `[CD Report Hub] Scanner AI alert: ${code}` : `[CD Report Hub] Scanner AI recovered: ${code}`;
  const text = kind === "incident"
    ? ["The scanner AI health check needs attention.", `Code: ${code}`, `State: ${health?.state ?? "unavailable"}`, `Last successful AI run: ${safeTimestamp(health?.lastSuccessAt ?? null)}`, "Review the operator console for details."].join("\n")
    : ["The scanner AI health check recovered.", `Previous code: ${code}`, `Last successful AI run: ${safeTimestamp(health?.lastSuccessAt ?? null)}`].join("\n");
  try {
    await bindings.email.send({ to: bindings.recipient, from: bindings.sender, subject, text });
  } catch {
    throw new CronIncident("alert_delivery_failed");
  }
}

async function reconcileAlert(env: Env, incidentCode: string | null, health?: AiHealth): Promise<void> {
  const bindings = alertBindings(env);
  if (!bindings) return;
  const stored = await readAlertState(bindings.state);
  if (incidentCode) {
    if (stored.incidentCode === incidentCode) return;
    await sendAlert(bindings, "incident", incidentCode, health);
    await writeAlertState(bindings.state, incidentCode);
    return;
  }
  if (!stored.incidentCode || health?.state === "idle") return;
  await sendAlert(bindings, "recovery", stored.incidentCode, health);
  await writeAlertState(bindings.state, null);
}

export async function runCron(env: Env, fetchImpl: Fetch = fetch, timeoutMs = CRON_TIMEOUT_MS): Promise<void> {
  let result: CronResult;
  try {
    result = await requestCron(env, fetchImpl, timeoutMs);
  } catch (error) {
    const incident = error instanceof CronIncident ? error : new CronIncident("cron_transport_error");
    await reconcileAlert(env, incident.code);
    throw incident;
  }
  const { health, automationStatus } = result;
  if (automationStatus === "failed" || automationStatus === "partial") {
    const incident = new CronIncident(`scanner_run_${automationStatus}`);
    await reconcileAlert(env, incident.code, health);
    throw incident;
  }
  if (health.state === "limited" || health.state === "unavailable") {
    const incident = new CronIncident(safeAiCode(health));
    await reconcileAlert(env, incident.code, health);
    throw incident;
  }
  if (automationStatus === "skipped" || automationStatus === "running") {
    await reconcileAlert(env, null, { ...health, state: "idle" });
    return;
  }
  await reconcileAlert(env, null, health);
}

const worker = {
  async scheduled(_controller: CronController, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};

export default worker;
