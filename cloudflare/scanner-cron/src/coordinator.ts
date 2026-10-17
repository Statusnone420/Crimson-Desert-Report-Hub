import { boundedNotification, parseAlertDelivery, runCron, type Env } from "./index";
import {
  SCANNER_ATTEMPT_START_KEY, SCANNER_EXECUTION_STATE_KEY, parseScannerAttemptStart,
  parseScannerExecutionState, type ScannerAttemptStart, type ScannerExecutionState,
} from "../../../src/lib/automation/diagnostics";

export interface CoordinatorStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(operation: (storage: CoordinatorStorage) => Promise<T>): Promise<T>;
}
type Lease = { start: ScannerAttemptStart; wake: string; expiresAt: number };
type Wake = { status: "running" | "completed" | "failed" | "expired" | "busy"; attemptId?: string };
const ALERT_KEY = "scanner-ai-health-alert-v1";
const LEASE_MS = 400_000;
const stateKeys = [SCANNER_EXECUTION_STATE_KEY, SCANNER_ATTEMPT_START_KEY, ALERT_KEY];
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** One stable SQLite object owns dispatch. KV is only a private display mirror. */
export class ScannerCoordinator {
  constructor(private readonly context: { storage: CoordinatorStorage }, private readonly env: Env) {}

  private async legacyState(): Promise<Map<string, string>> {
    const imported = new Map<string, string>();
    if (await this.context.storage.get("bootstrapped") || !this.env.ALERT_STATE) return imported;
    const values = await boundedNotification(() => Promise.all(stateKeys.map((key) => this.env.ALERT_STATE!.get(key))));
    for (let index = 0; index < stateKeys.length; index++) {
      const raw = values[index];
      if (raw === null) continue;
      if (bytes(raw) > 32_768) throw new Error("scanner_coordinator_bootstrap_invalid");
      const value: unknown = JSON.parse(raw);
      const key = stateKeys[index];
      if (key === SCANNER_EXECUTION_STATE_KEY) {
        const parsed = parseScannerExecutionState(value);
        if (!parsed || Date.parse(parsed.latestAttempt.finishedAt) > Date.now() + 60_000) throw new Error("scanner_coordinator_bootstrap_invalid");
        imported.set(key, JSON.stringify(parsed));
      } else if (key === SCANNER_ATTEMPT_START_KEY) {
        const parsed = parseScannerAttemptStart(value);
        if (!parsed || Date.parse(parsed.startedAt) > Date.now() + 60_000) throw new Error("scanner_coordinator_bootstrap_invalid");
        imported.set(key, JSON.stringify(parsed));
      } else {
        const row = value as { incidentCode?: unknown; delivery?: unknown } | null;
        if (!row || (row.incidentCode !== null && (typeof row.incidentCode !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(row.incidentCode)))) {
          throw new Error("scanner_coordinator_bootstrap_invalid");
        }
        const delivery = row.delivery === undefined ? null : parseAlertDelivery(row.delivery);
        if (row.delivery !== undefined && !delivery) throw new Error("scanner_coordinator_bootstrap_invalid");
        // Import an existing incident as unknown delivery. Do not send it again.
        const prior = delivery ?? (row.incidentCode ? { id: crypto.randomUUID(), episodeId: crypto.randomUUID(),
          code: row.incidentCode, kind: "incident", state: "unknown", at: new Date().toISOString() } : null);
        imported.set(key, JSON.stringify({ incidentCode: row.incidentCode, ...(prior ? { delivery: prior } : {}) }));
      }
    }
    return imported;
  }

  private async claim(wake: string): Promise<Lease | Wake> {
    const imported = await this.legacyState();
    return this.context.storage.transaction(async (storage) => {
      const prior = await storage.get<Wake>(`wake:${wake}`);
      if (prior) return prior;
      if (!await storage.get("bootstrapped")) {
        for (const [key, value] of imported) await storage.put(key, value);
        await storage.put("bootstrapped", true);
      }
      const active = await storage.get<Lease>("active");
      if (active && active.expiresAt > Date.now()) {
        const busy: Wake = { status: "busy", attemptId: active.start.id };
        await storage.put(`wake:${wake}`, busy);
        return busy;
      }
      if (active) {
        await storage.put(`wake:${active.wake}`, { status: "expired", attemptId: active.start.id });
        const raw = await storage.get<string>(SCANNER_EXECUTION_STATE_KEY);
        const previous = raw ? parseScannerExecutionState(JSON.parse(raw)) : null;
        const attempt = { ...active.start, finishedAt: new Date().toISOString(), outcome: "failed" as const,
          diagnostics: [{ stage: "request" as const, code: "completion_missing" as const }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: null, persistence: "unconfirmed" as const };
        const snapshot: ScannerExecutionState = { version: 1, ...previous, latestAttempt: attempt,
          lastFailedAttempt: attempt, lastSuccessfulScanAt: previous?.lastSuccessfulScanAt ?? null,
          lastSuccessfulAiAt: previous?.lastSuccessfulAiAt ?? null,
          lastFailureReceipt: { attempt, evidence: null, recoveredAt: null, canRecoverWithoutAi: false,
            firstAttempt: previous?.lastFailureReceipt && !previous.lastFailureReceipt.recoveredAt
              ? previous.lastFailureReceipt.firstAttempt ?? previous.lastFailureReceipt.attempt : attempt,
            firstEvidence: previous?.lastFailureReceipt && !previous.lastFailureReceipt.recoveredAt
              ? previous.lastFailureReceipt.firstEvidence !== undefined
                ? previous.lastFailureReceipt.firstEvidence : previous.lastFailureReceipt.evidence : null } };
        await storage.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(snapshot));
      }
      const lease: Lease = { wake, start: { id: crypto.randomUUID(), startedAt: new Date().toISOString() }, expiresAt: Date.now() + LEASE_MS };
      await storage.put("active", lease);
      await storage.put(`wake:${wake}`, { status: "running", attemptId: lease.start.id });
      return lease;
    });
  }

  private store(lease: Lease): NonNullable<Env["ALERT_STATE"]> {
    const owned = async <T>(operation: (storage: CoordinatorStorage) => Promise<T>): Promise<T> =>
      this.context.storage.transaction(async (storage) => {
        const active = await storage.get<Lease>("active");
        if (active?.start.id !== lease.start.id || active.expiresAt <= Date.now()) throw new Error("scanner_coordinator_stale_completion");
        return operation(storage);
      });
    return { get: (key) => owned(async (storage) => await storage.get<string>(key) ?? null),
      put: (key, value) => owned((storage) => storage.put(key, value)) };
  }

  private async mirror(lease: Lease, store: NonNullable<Env["ALERT_STATE"]>): Promise<void> {
    if (!this.env.ALERT_STATE) return;
    const raw = await store.get(SCANNER_EXECUTION_STATE_KEY);
    if (!raw) return;
    const snapshot = parseScannerExecutionState(JSON.parse(raw));
    if (!snapshot || snapshot.latestAttempt.id !== lease.start.id) throw new Error("scanner_coordinator_stale_completion");
    const alertRaw = await store.get(ALERT_KEY);
    const delivery = alertRaw ? parseAlertDelivery(JSON.parse(alertRaw).delivery) : null;
    if (delivery) snapshot.alertDelivery = { ...delivery, state: delivery.state === "dispatching" ? "unknown" : delivery.state };
    const value = JSON.stringify(snapshot);
    if (bytes(value) > 32_768) throw new Error("scanner_coordinator_mirror_too_large");
    await store.put(SCANNER_EXECUTION_STATE_KEY, value);
    // One completion write per attempt; intermediate dispatch states stay local.
    await boundedNotification(() => this.env.ALERT_STATE!.put(SCANNER_EXECUTION_STATE_KEY, value));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/wake") return new Response(null, { status: 404 });
    const body = await request.text();
    if (bytes(body) > 512) return new Response(null, { status: 400 });
    let wake: unknown;
    try { wake = (JSON.parse(body) as { wake?: unknown }).wake; } catch { return new Response(null, { status: 400 }); }
    if (typeof wake !== "string" || !/^\d{13}:[0-9* /,\-]{1,100}$/.test(wake)) return new Response(null, { status: 400 });
    let claimed: Lease | Wake;
    try { claimed = await this.claim(wake); }
    catch { console.error(JSON.stringify({ event: "scanner_coordinator_failed", code: "bootstrap_or_storage_unavailable" })); return new Response(null, { status: 503 }); }
    if (!("start" in claimed)) return Response.json(claimed, { status: claimed.status === "failed" || claimed.status === "expired" ? 503 : 200 });
    const lease = claimed;
    const store = this.store(lease);
    let failed = false;
    let startMirrorFailed = false;
    if (this.env.ALERT_STATE) {
      try { await boundedNotification(() => this.env.ALERT_STATE!.put(SCANNER_ATTEMPT_START_KEY, JSON.stringify(lease.start))); }
      catch { startMirrorFailed = true; }
    }
    try {
      await runCron({ ...this.env, ALERT_STATE: this.env.ALERT_STATE ? store : undefined }, fetch, undefined,
        { start: lease.start, executionState: store, startMirrorFailed });
    } catch { failed = true; }
    try { await this.mirror(lease, store); }
    catch { failed = true; console.error(JSON.stringify({ event: "scanner_status_mirror_failed", id: lease.start.id })); }
    try {
      await this.context.storage.transaction(async (storage) => {
        const active = await storage.get<Lease>("active");
        if (active?.start.id !== lease.start.id || active.expiresAt <= Date.now()) throw new Error("scanner_coordinator_stale_completion");
        await storage.put(`wake:${wake}`, { status: failed ? "failed" : "completed", attemptId: lease.start.id });
        await storage.put("active", null);
      });
    } catch { failed = true; }
    return Response.json({ status: failed ? "failed" : "completed", attemptId: lease.start.id }, { status: failed ? 503 : 200 });
  }
}
