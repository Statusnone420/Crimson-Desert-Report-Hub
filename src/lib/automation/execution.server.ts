import "server-only";

import { isAdmin } from "@/lib/adminGuard";
import { isVercelPreview } from "@/lib/previewGuard";
import {
  SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY,
  parseScannerAttemptStart, parseScannerExecutionState, type ScannerExecutionRead,
} from "@/lib/automation/diagnostics";

const MAX_BYTES = 32 * 1024;
const TIMEOUT_MS = 4_000;
type ValueRead = { kind: "value"; value: unknown } | { kind: "missing" } | { kind: "error"; code: string };

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error("oversized body");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function readValue(url: string, token: string): Promise<ValueRead> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let received = false;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal });
    received = true;
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return { kind: "missing" };
      return { kind: "error", code: response.status === 401 || response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited" : "service_unavailable" };
    }
    return { kind: "value", value: await boundedJson(response) };
  } catch {
    return { kind: "error", code: signal.aborted ? "read_timeout" : received ? "invalid_response" : "connection_failed" };
  }
}

const READ_REASONS: Record<string, string> = {
  access_denied: "Cloudflare denied the status read. Check the server token's Workers KV Storage Read permission and account scope.",
  rate_limited: "Cloudflare rate-limited the status read. Refresh the console after the limit clears.",
  service_unavailable: "Cloudflare returned an unsuccessful status response. Check its API status and the next trigger record.",
  read_timeout: "The Cloudflare status read exceeded four seconds. Refresh the console and check Cloudflare availability.",
  invalid_response: "The saved trigger record is malformed or uses an unsupported format. Check the deployed Worker and its private logs.",
  connection_failed: "The console could not reach Cloudflare's status API. Check Vercel network logs and Cloudflare availability.",
  namespace_unverified: "The configured KV namespace could not be verified. Check the account and namespace IDs; missing data is not proof of no attempts.",
  future_timestamp: "The trigger record contains a future timestamp. Check the stored record and runtime clocks before trusting its age.",
};

/** Private, uncached evidence independent of Supabase. This function never writes to Cloudflare. */
export async function getScannerExecution(): Promise<ScannerExecutionRead> {
  const empty = { started: null, snapshot: null };
  if (!(await isAdmin())) return { state: "unavailable", code: "admin_required", detail: "Sign in to read private trigger diagnostics.", ...empty };
  if (isVercelPreview()) return { state: "preview", code: null, detail: "Preview deployments do not read production trigger diagnostics.", ...empty };
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const namespace = process.env.CLOUDFLARE_SCANNER_KV_NAMESPACE_ID?.trim();
  const token = process.env.CLOUDFLARE_SCANNER_STATUS_TOKEN?.trim();
  if (!account || !namespace || !token) return { state: "not_configured", code: "status_reader_not_configured",
    detail: "Private trigger diagnostics are not connected. Configure the server's Cloudflare account, scanner KV namespace, and read token before release.", ...empty };
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-f0-9]{32}$/i.test(namespace)) return { state: "unavailable", code: "configuration_invalid",
    detail: "The configured Cloudflare account or scanner KV namespace ID is invalid. Check the server settings.", ...empty };
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}`;
  const reads = await Promise.allSettled([
    readValue(`${base}/values/${SCANNER_ATTEMPT_START_KEY}`, token),
    readValue(`${base}/values/${SCANNER_EXECUTION_STATE_KEY}`, token),
  ]);
  const values = reads.map((read): ValueRead => read.status === "fulfilled" ? read.value : { kind: "error", code: "connection_failed" });
  const [startRead, stateRead] = values;
  const started = startRead.kind === "value" ? parseScannerAttemptStart(startRead.value) : null;
  const snapshot = stateRead.kind === "value" ? parseScannerExecutionState(stateRead.value) : null;
  const failed = values.find((read) => read.kind === "error");
  let code = failed?.kind === "error" ? failed.code : null;
  if (!code && ((startRead.kind === "value" && !started) || (stateRead.kind === "value" && !snapshot))) code = "invalid_response";
  const futureLimit = Date.now() + 60_000;
  if (!code && ((started && Date.parse(started.startedAt) > futureLimit) || (snapshot && Date.parse(snapshot.latestAttempt.finishedAt) > futureLimit))) code = "future_timestamp";
  if (code) return { state: "unavailable", code, detail: READ_REASONS[code], started, snapshot };
  if (!started && !snapshot) {
    // A 404 can also mean an incorrect namespace. Verify it before declaring an empty history.
    const namespaceRead = await readValue(base, token);
    const data = namespaceRead.kind === "value" ? namespaceRead.value as { success?: unknown; result?: { id?: unknown } } | null : null;
    if (!data || data.success !== true || data.result?.id !== namespace) {
      const reason = namespaceRead.kind === "error" ? namespaceRead.code : "namespace_unverified";
      return { state: "unavailable", code: reason, detail: READ_REASONS[reason], ...empty };
    }
    return { state: "no_attempt", code: "first_attempt_pending", detail: "The KV namespace is reachable, but the Worker has not saved a trigger record yet. Verify its deployment and next hourly invocation.", ...empty };
  }
  return { state: "available", code: null,
    detail: "Private Cloudflare trigger records. KV updates can take about a minute to appear. Run-history totals cover database records separately.", started, snapshot };
}
