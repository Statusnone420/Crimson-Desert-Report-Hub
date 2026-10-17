import { afterEach, describe, expect, it, vi } from "vitest";
import { ScannerCoordinator, type CoordinatorStorage } from "../cloudflare/scanner-cron/src/coordinator";
import worker, { type Env } from "../cloudflare/scanner-cron/src/index";
import { SCANNER_ATTEMPT_HEADER, SCANNER_EXECUTION_STATE_KEY, parseScannerExecutionState } from "@/lib/automation/diagnostics";
import { OpenRouterAttemptTrace, type OpenRouterAttempt } from "@/lib/automation/openRouterTrace";
import type { ScannerAiEvidence } from "@/lib/automation/openRouterReadout";

class Storage implements CoordinatorStorage {
  values = new Map<string, unknown>();
  private tail = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, structuredClone(value)); }
  async transaction<T>(operation: (storage: CoordinatorStorage) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const previous = new Map(this.values);
      try { return await operation(this); } catch (error) { this.values = previous; throw error; }
    });
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
function fixture() {
  const storage = new Storage();
  const mirror = new Map<string, string>();
  const email = { send: vi.fn(async () => {}) };
  const state = { get: vi.fn(async (key: string) => mirror.get(key) ?? null), put: vi.fn(async (key: string, value: string) => { mirror.set(key, value); }) };
  const env: Env = { CRON_URL: "https://fixture.test/api/cron/keepalive", CRON_SECRET: "fixture-key", ALERT_STATE: state,
    ALERT_EMAIL: email, ALERT_SENDER: "fixture@example.test", ALERT_RECIPIENT: "owner@example.test" };
  return { storage, mirror, email, state, env, object: new ScannerCoordinator({ storage }, env) };
}
const wake = (number = Date.now()) => new Request("https://scanner.internal/wake", { method: "POST", body: JSON.stringify({ wake: `${number}:0 * * * *` }) });
const healthy = () => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" }, aiHealth: { state: "healthy", code: null, message: "Validated", lastSuccessAt: new Date().toISOString() } });
function failed(_input: RequestInfo | URL, init?: RequestInit) {
  const now = new Date().toISOString();
  return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
    attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now, outcome: "failed",
      diagnostics: [{ stage: "run_finalize", code: "database_timeout" }], errorCount: 1,
      skipReason: null, nextEligibleAt: null, httpStatus: 503, persistence: "unconfirmed" } }, { status: 503 });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("durable scanner coordinator", () => {
  it.each([true, undefined, false])("keeps clean persisted %s reporting eligibility consistent with its alert", async eligibility => {
    const f = fixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "partial" },
        aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null },
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "partial", diagnostics: [{ stage: "health_read", code: "database_unavailable" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } });
    });
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    const persisted = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    if (eligibility === undefined) delete persisted.lastFailureReceipt.canRecoverWithoutAi;
    else persisted.lastFailureReceipt.canRecoverWithoutAi = eligibility;
    await f.storage.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(persisted));
    fetcher.mockImplementation(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2)); await f.object.fetch(wake(number + 3));
    const idle = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(idle.lastFailureReceipt.canRecoverWithoutAi).toBe(eligibility !== false);
    expect(idle.lastFailureReceipt.firstAttempt).toEqual(persisted.lastFailureReceipt.firstAttempt);
    expect(idle.lastFailureReceipt.firstEvidence).toEqual(persisted.lastFailureReceipt.firstEvidence);
    if (eligibility === false) {
      expect(idle.lastFailureReceipt.recoveredAt).toBeNull();
      expect(idle.alertDelivery).toEqual(persisted.alertDelivery);
      expect(f.email.send).toHaveBeenCalledOnce();
    } else {
      expect(idle.lastFailureReceipt.recoveredAt).toBeTruthy();
      expect(idle.alertDelivery).toMatchObject({ code: "scanner_completed_warning", kind: "recovery", state: "sent" });
      expect(f.email.send).toHaveBeenCalledTimes(2);
    }
    fetcher.mockImplementation(healthy);
    await f.object.fetch(wake(number + 4)); await f.object.fetch(wake(number + 5));
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeTruthy();
    expect(f.email.send).toHaveBeenCalledTimes(2);
  });
  it.each([true, undefined].flatMap(eligibility => ["evidence", "firstEvidence"].flatMap(field =>
    ["reserved_unknown", "unknown"].map(costState => ({ eligibility, field, costState }))))) (
    "rechecks persisted $eligibility eligibility against retained $field with $costState cost", async ({ eligibility, field, costState }) => {
      const f = fixture();
      const warning = (_input: RequestInfo | URL, init?: RequestInit) => {
        const now = new Date().toISOString();
        return Response.json({ ok: false, automation: { status: "partial" },
          aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null },
          attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
            outcome: "partial", diagnostics: [{ stage: "health_read", code: "database_unavailable" }], errorCount: 1,
            skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } });
      };
      const fetcher = vi.fn(warning);
      vi.stubGlobal("fetch", fetcher);
      const number = Date.now();
      await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
      const persisted = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      persisted.lastFailureReceipt[field] = { version: 1, attemptedCalls: costState === "unknown" ? null : 1, validatedCalls: 0, costState,
        latestAttempt: null, lastProblem: null, diagnostic: null, checkpointFailures: 0, dropped: 0 };
      if (eligibility === undefined) delete persisted.lastFailureReceipt.canRecoverWithoutAi;
      else persisted.lastFailureReceipt.canRecoverWithoutAi = eligibility;
      await f.storage.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(persisted));
      const idle = () => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
        aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null } });
      fetcher.mockImplementationOnce(idle);
      await f.object.fetch(wake(number + 2));
      const held = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(held.lastFailureReceipt.recoveredAt).toBeNull();
      expect(held.lastFailureReceipt.canRecoverWithoutAi).toBe(false);
      expect(held.lastFailureReceipt.firstEvidence).toEqual(persisted.lastFailureReceipt.firstEvidence);
      expect(held.alertDelivery).toEqual(persisted.alertDelivery);
      await f.object.fetch(wake(number + 3));
      expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.canRecoverWithoutAi).toBe(false);
      fetcher.mockImplementationOnce(idle);
      await f.object.fetch(wake(number + 4));
      expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeNull();
      expect(f.email.send).toHaveBeenCalledOnce();
      fetcher.mockImplementationOnce(healthy);
      await f.object.fetch(wake(number + 5));
      const recovered = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(recovered.lastFailureReceipt.recoveredAt).toBeTruthy();
      expect(recovered.lastFailureReceipt.firstAttempt).toEqual(persisted.lastFailureReceipt.firstAttempt);
      expect(recovered.lastFailureReceipt.firstEvidence).toEqual(persisted.lastFailureReceipt.firstEvidence);
      expect(f.email.send).toHaveBeenCalledTimes(2);
      await f.object.fetch(wake(number + 6)); await f.object.fetch(wake(number + 7));
      const next = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(next.lastFailureReceipt.canRecoverWithoutAi).toBe(true);
      expect(next.lastFailureReceipt.firstAttempt.id).not.toBe(persisted.lastFailureReceipt.firstAttempt.id);
      fetcher.mockImplementationOnce(idle);
      await f.object.fetch(wake(number + 8));
      expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeTruthy();
      expect(f.email.send).toHaveBeenCalledTimes(4);
    });
  it.each(["warning", "idle", "healthy"].flatMap(outcome =>
    ["lastProblem", "reserved_unknown", "unvalidated", "unknown_cost_null", "unknown_cost_zero"].map(ambiguity => ({ outcome, ambiguity }))))(
    "retains execution incidents through $outcome scans with $ambiguity evidence", async ({ outcome, ambiguity }) => {
      const f = fixture();
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const now = new Date().toISOString();
        return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
          attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
            outcome: "failed", diagnostics: [{ stage: "database_check", code: "database_unavailable" }], errorCount: 1,
            skipReason: null, nextEligibleAt: null, httpStatus: 503 } }, { status: 503 });
      });
      vi.stubGlobal("fetch", fetcher);
      const number = Date.now();
      await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
      const first = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      let problem: OpenRouterAttempt | null = null;
      const trace = new OpenRouterAttemptTrace("extraction", 1, attempt => { problem = attempt; });
      await trace.start(); trace.fetchStarted(1_000); await trace.finish("timeout", "verified");
      const evidence: ScannerAiEvidence = { version: 1,
        attemptedCalls: ambiguity === "unknown_cost_null" ? null : ambiguity === "unknown_cost_zero" ? 0 : 1,
        validatedCalls: ambiguity === "unvalidated" || ambiguity.startsWith("unknown_cost") ? 0 : 1,
        costState: ambiguity === "reserved_unknown" ? "reserved_unknown" : ambiguity.startsWith("unknown_cost") ? "unknown" : "verified", latestAttempt: null,
        lastProblem: ambiguity === "lastProblem" ? problem : null, diagnostic: null, checkpointFailures: 0, dropped: 0 };
      fetcher.mockImplementationOnce((_input, init) => {
        const now = new Date().toISOString();
        const warning = outcome === "warning";
        return Response.json({ ok: !warning, automation: { status: warning ? "partial" : "success", persistence: "recorded" },
          aiHealth: { state: warning ? "unavailable" : outcome, code: warning ? "ai_history_unavailable" : null,
            message: "Fixture", lastSuccessAt: outcome === "healthy" ? now : null }, aiEvidence: evidence,
          ...(warning ? { attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
            outcome: "partial", diagnostics: [{ stage: "health_read", code: "database_unavailable" }], errorCount: 1,
            skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } } : {}) });
      });
      await f.object.fetch(wake(number + 2));
      const ambiguous = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(ambiguous.lastFailureReceipt.canRecoverWithoutAi).toBe(false);
      expect(ambiguous.lastFailureReceipt.recoveredAt).toBeNull();
      expect(ambiguous.lastFailureReceipt.firstAttempt).toEqual(first.lastFailureReceipt.firstAttempt);
      expect(ambiguous.lastFailureReceipt.firstEvidence).toEqual(first.lastFailureReceipt.firstEvidence);
      expect(ambiguous.alertDelivery).toEqual(first.alertDelivery);
      expect(f.email.send).toHaveBeenCalledOnce();
      fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
        aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } }));
      await f.object.fetch(wake(number + 3));
      const idle = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(idle.lastFailureReceipt).toEqual(ambiguous.lastFailureReceipt);
      expect(idle.alertDelivery).toEqual(first.alertDelivery);
      expect(f.email.send).toHaveBeenCalledOnce();
      fetcher.mockImplementation(healthy);
      await f.object.fetch(wake(number + 4)); await f.object.fetch(wake(number + 5));
      const recovered = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
      expect(recovered.lastFailureReceipt.recoveredAt).toBeTruthy();
      expect(recovered.lastFailureReceipt.firstAttempt).toEqual(first.lastFailureReceipt.firstAttempt);
      expect(recovered.lastFailureReceipt.firstEvidence).toEqual(first.lastFailureReceipt.firstEvidence);
      expect(recovered.alertDelivery).toMatchObject({ kind: "recovery", state: "sent" });
      expect(f.email.send).toHaveBeenCalledTimes(2);
    });
  it.each([
    { reportingOnly: false, healthUnavailable: false },
    { reportingOnly: true, healthUnavailable: false },
    { reportingOnly: true, healthUnavailable: true },
  ])("does not recover a provider alert from a later unrelated receipt ($reportingOnly, $healthUnavailable)", async ({ reportingOnly, healthUnavailable }) => {
    const f = fixture();
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Response>(() => Response.json({ ok: true,
      automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "unavailable", code: "openrouter_no_route", message: "Fixture", lastSuccessAt: null } }));
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    const provider = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(provider.lastFailureReceipt).toBeNull();
    expect(provider.alertDelivery).toMatchObject({ code: "openrouter_no_route", kind: "incident", state: "sent" });
    expect(f.email.send).toHaveBeenCalledOnce();

    fetcher.mockImplementation((_input, init) => {
      const now = new Date().toISOString();
      const outcome = reportingOnly ? "partial" : "failed";
      return Response.json({ ok: false, automation: { status: outcome },
        aiHealth: reportingOnly && !healthUnavailable ? { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } : null,
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome, diagnostics: [{ stage: reportingOnly ? healthUnavailable ? "health_read" : "progress_write" : "database_check", code: "database_unavailable" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: reportingOnly ? 200 : 503,
          ...(reportingOnly ? { persistence: "recorded", warningOnly: true } : {}) } }, { status: reportingOnly ? 200 : 503 });
    });
    await f.object.fetch(wake(number + 2));
    const firstReceipt = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt;
    await f.object.fetch(wake(number + 3));
    const failed = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(failed.lastFailureReceipt).toMatchObject({ canRecoverWithoutAi: true, recoveredAt: null,
      firstAttempt: firstReceipt.firstAttempt });
    expect(failed.alertDelivery).toEqual(provider.alertDelivery);
    expect(f.email.send).toHaveBeenCalledOnce();

    fetcher.mockImplementation(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 4)); await f.object.fetch(wake(number + 5));
    const idle = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(idle.lastFailureReceipt.recoveredAt).toBeTruthy();
    expect(idle.lastFailureReceipt.firstAttempt).toEqual(firstReceipt.firstAttempt);
    expect(idle.lastAiIncident).toEqual(provider.lastAiIncident);
    expect(idle.alertDelivery).toEqual(provider.alertDelivery);
    expect(JSON.parse(String(f.storage.values.get("scanner-ai-health-alert-v1"))).incidentCode).toBe("openrouter_no_route");
    expect(f.email.send).toHaveBeenCalledOnce();

    fetcher.mockImplementation(healthy);
    await f.object.fetch(wake(number + 6)); await f.object.fetch(wake(number + 7));
    const recovered = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(recovered.lastFailureReceipt).toEqual(idle.lastFailureReceipt);
    expect(recovered.alertDelivery).toMatchObject({ code: "openrouter_no_route", kind: "recovery", state: "sent" });
    expect(JSON.parse(String(f.storage.values.get("scanner-ai-health-alert-v1"))).incidentCode).toBeNull();
    expect(f.email.send).toHaveBeenCalledTimes(2);
  });
  it.each(["unavailable", "limited"])("retains an execution incident through later %s AI until validated recovery", async state => {
    const f = fixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "failed", diagnostics: [{ stage: "database_check", code: "database_unavailable" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 503 } }, { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    const execution = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(execution.lastFailureReceipt.canRecoverWithoutAi).toBe(true);
    expect(execution.alertDelivery).toMatchObject({ code: "scanner_database_check_database_unavailable", kind: "incident", state: "sent" });
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state, code: "openrouter_no_route", message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2));
    const provider = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(provider.alertDelivery).toEqual(execution.alertDelivery);
    expect(provider.lastFailureReceipt.attempt).toEqual(execution.lastFailureReceipt.attempt);
    expect(provider.lastFailureReceipt.canRecoverWithoutAi).toBe(false);
    fetcher.mockImplementation(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 3)); await f.object.fetch(wake(number + 4));
    const idle = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(idle.lastFailureReceipt.recoveredAt).toBeNull();
    expect(idle.lastFailureReceipt.firstAttempt).toEqual(execution.lastFailureReceipt.firstAttempt);
    expect(idle.alertDelivery).toEqual(execution.alertDelivery);
    expect(f.email.send).toHaveBeenCalledOnce();
    fetcher.mockImplementation(healthy);
    await f.object.fetch(wake(number + 5)); await f.object.fetch(wake(number + 6));
    const recovered = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(recovered.lastFailureReceipt.recoveredAt).toBeTruthy();
    expect(recovered.lastFailureReceipt.firstAttempt).toEqual(execution.lastFailureReceipt.firstAttempt);
    expect(recovered.alertDelivery).toMatchObject({ code: "scanner_database_check_database_unavailable", kind: "recovery", state: "sent" });
    expect(f.email.send).toHaveBeenCalledTimes(2);
  });
  it("recovers an execution-only incident with idle AI once, preserving its receipts", async () => {
    const f = fixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "failed", diagnostics: [{ stage: "database_check", code: "database_unavailable" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 503 } }, { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    const before = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(f.email.send).toHaveBeenCalledOnce();
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "skipped" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2));
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeNull();
    const savedIdle = () => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } });
    fetcher.mockImplementationOnce(savedIdle);
    await f.object.fetch(wake(number + 3));
    const after = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(after.lastFailureReceipt.recoveredAt).toBeTruthy();
    expect(after.lastFailureReceipt.firstAttempt).toEqual(before.lastFailureReceipt.firstAttempt);
    expect(after.lastFailureReceipt.attempt).toEqual(before.lastFailureReceipt.attempt);
    expect(after.alertDelivery).toMatchObject({ kind: "recovery", state: "sent" });
    expect(f.email.send).toHaveBeenCalledTimes(2);
    fetcher.mockImplementationOnce(savedIdle);
    await f.object.fetch(wake(number + 4));
    expect(f.email.send).toHaveBeenCalledTimes(2);
    await f.object.fetch(wake(number + 5)); await f.object.fetch(wake(number + 6));
    expect(f.email.send).toHaveBeenCalledTimes(3);
    const next = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(next.lastFailureReceipt.recoveredAt).toBeNull();
    expect(next.lastFailureReceipt.firstAttempt.id).not.toBe(before.lastFailureReceipt.firstAttempt.id);
  });
  it.each(["run_finalize", "paid_accounting", "request"] as const)("keeps an execution incident open after intervening %s ambiguity", async stage => {
    const f = fixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "failed", diagnostics: [{ stage: "database_check", code: "database_unavailable" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 503 } }, { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number));
    fetcher.mockImplementationOnce((_input, init) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "failed" }, aiHealth: null,
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "failed", diagnostics: [{ stage, code: stage === "paid_accounting" ? "settlement_unacknowledged" : stage === "request" ? "request_timeout" : "database_timeout" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 503, persistence: "unconfirmed" } }, { status: 503 });
    });
    await f.object.fetch(wake(number + 1));
    const before = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(before.lastFailureReceipt.canRecoverWithoutAi).toBe(false);
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Disabled by owner", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2));
    const after = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(after.lastFailureReceipt.recoveredAt).toBeNull();
    expect(after.lastFailureReceipt.firstAttempt).toEqual(before.lastFailureReceipt.firstAttempt);
    expect(after.lastFailureReceipt.attempt).toEqual(before.lastFailureReceipt.attempt);
  });
  it.each([false, true])("does not recover mixed accounting/AI failures from a later clean idle scan (warning first: %s)", async (warningFirst) => {
    const f = fixture();
    const warning = (_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "partial" },
        aiHealth: { state: warningFirst ? "limited" : "idle", code: warningFirst ? "openrouter_cost_unverified" : "ai_disabled", message: "Fixture", lastSuccessAt: null },
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now, finishedAt: now,
          outcome: "partial", diagnostics: [{ stage: "progress_write", code: "database_timeout" }], errorCount: 1,
          skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } });
    };
    const fetcher = vi.fn(warning);
    if (!warningFirst) fetcher.mockImplementationOnce(failed);
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.canRecoverWithoutAi).toBe(false);
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2));
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeNull();
    // A one-scan save failure followed by saved scans sends nothing; a repeated AI failure emails once.
    expect(f.email.send).toHaveBeenCalledTimes(warningFirst ? 1 : 0);
  });
  it.each(["idle", "not_attempted", "healthy", "ai_history_unavailable"])("recovers a reporting-only incident with %s AI and no ambiguous evidence", async aiState => {
    const f = fixture();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "partial" }, aiHealth: {
        state: aiState === "ai_history_unavailable" ? "unavailable" : aiState === "not_attempted" ? "idle" : aiState,
        code: aiState === "ai_history_unavailable" ? aiState : aiState === "idle" ? "ai_disabled" : null,
        message: "Fixture", lastSuccessAt: aiState === "idle" ? null : now },
        ...(aiState !== "idle" ? { aiEvidence: { version: 1,
          attemptedCalls: aiState === "not_attempted" ? 0 : 1, validatedCalls: aiState === "not_attempted" ? 0 : 1,
          costState: aiState === "not_attempted" ? "not_attempted" : "verified",
          latestAttempt: null, lastProblem: null, diagnostic: null, checkpointFailures: 1, dropped: 0 } } : {}),
        attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER), startedAt: now,
        finishedAt: now, outcome: "partial", diagnostics: [{ stage: "progress_write", code: "database_timeout" }], errorCount: 1,
        skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } });
    });
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    expect(f.email.send).toHaveBeenCalledOnce();
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "recorded" },
      aiHealth: { state: "idle", code: "ai_disabled", message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 2));
    expect(f.email.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeTruthy();
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).alertDelivery).toMatchObject({ kind: "recovery", state: "sent" });
  });
  it("keeps one saved-completion warning quiet, preserves its count across skips, and alerts once if repeated", async () => {
    const f = fixture();
    const warning = (_input: RequestInfo | URL, init?: RequestInit) => {
      const now = new Date().toISOString();
      return Response.json({ ok: false, automation: { status: "partial" }, aiHealth: { state: "healthy", code: null,
        message: "Fixture", lastSuccessAt: now }, attempt: { id: new Headers(init?.headers).get(SCANNER_ATTEMPT_HEADER),
        startedAt: now, finishedAt: now, outcome: "partial", diagnostics: [{ stage: "progress_write", code: "database_timeout" }],
        errorCount: 1, skipReason: null, nextEligibleAt: null, httpStatus: 200, persistence: "recorded", warningOnly: true } });
    };
    const fetcher = vi.fn(warning); vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number));
    expect(f.email.send).not.toHaveBeenCalled();
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "skipped" },
      aiHealth: { state: "healthy", code: null, message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 1));
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).consecutiveWarnings).toBe(1);
    await f.object.fetch(wake(number + 2));
    await f.object.fetch(wake(number + 3));
    expect(f.email.send).toHaveBeenCalledOnce();
    const savedSuccess = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastSuccessfulScanAt;
    fetcher.mockImplementationOnce(() => Response.json({ ok: true, automation: { status: "success", persistence: "unconfirmed" },
      aiHealth: { state: "healthy", code: null, message: "Fixture", lastSuccessAt: null } }));
    await f.object.fetch(wake(number + 4));
    expect(f.email.send).toHaveBeenCalledOnce();
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastSuccessfulScanAt).toBe(savedSuccess);
    fetcher.mockImplementationOnce(() => healthy());
    await f.object.fetch(wake(number + 5));
    expect(f.email.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt.recoveredAt).toBeTruthy();
  });
  it("admits one concurrent duplicate wake and retains dedupe after object recreation", async () => {
    const f = fixture();
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    const first = f.object.fetch(wake(number));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect((await f.object.fetch(wake(number))).status).toBe(200);
    expect((await f.object.fetch(wake(number + 1))).status).toBe(200);
    release(healthy());
    expect((await first).status).toBe(200);
    const recreated = new ScannerCoordinator({ storage: f.storage }, f.env);
    expect((await recreated.fetch(wake(number))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(f.state.put.mock.calls.filter(([key]) => key === SCANNER_EXECUTION_STATE_KEY)).toHaveLength(1);
  });
  it("reserves notification dispatch before sending and never replays a lost acknowledgment", async () => {
    const f = fixture();
    f.email.send.mockImplementation(async () => {
      expect(JSON.parse(String(f.storage.values.get("scanner-ai-health-alert-v1"))).delivery.state).toBe("dispatching");
      throw new Error("PRIVATE provider error");
    });
    vi.stubGlobal("fetch", vi.fn(failed));
    const number = Date.now();
    expect((await f.object.fetch(wake(number))).status).toBe(503);
    expect(f.email.send).not.toHaveBeenCalled();
    expect((await f.object.fetch(wake(number + 1))).status).toBe(503);
    expect(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).alertDelivery.state).toBe("unknown");
    expect((await f.object.fetch(wake(number + 2))).status).toBe(503);
    expect(f.email.send).toHaveBeenCalledOnce();
    expect(JSON.stringify([...f.storage.values.values()])).not.toContain("PRIVATE");
  });
  it("does not reopen notification eligibility after a mirror failure", async () => {
    const f = fixture();
    f.state.put.mockImplementation(async (key, value) => {
      if (key === SCANNER_EXECUTION_STATE_KEY) throw new Error("fixture mirror failure");
      f.mirror.set(key, value);
    });
    vi.stubGlobal("fetch", vi.fn(failed));
    const number = Date.now();
    await f.object.fetch(wake(number));
    await f.object.fetch(wake(number + 1));
    expect(f.email.send).toHaveBeenCalledOnce();
    expect(JSON.parse(String(f.storage.values.get("scanner-ai-health-alert-v1"))).delivery.state).toBe("sent");
  });
  it("preserves the first failure receipt and marks recovery without repeating incidents", async () => {
    const f = fixture();
    const fetcher = vi.fn(failed).mockImplementationOnce(failed).mockImplementationOnce(failed).mockImplementationOnce(() => healthy());
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number)); await f.object.fetch(wake(number + 1));
    const first = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!).lastFailureReceipt;
    await f.object.fetch(wake(number + 2));
    const snapshot = parseScannerExecutionState(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!))!;
    expect(snapshot.lastFailureReceipt?.attempt).toEqual(first.attempt);
    expect(snapshot.lastFailureReceipt?.recoveredAt).toBeTruthy();
    expect(snapshot.alertDelivery).toMatchObject({ state: "sent", kind: "recovery" });
    expect(f.email.send).toHaveBeenCalledTimes(2);
  });
  it("preserves explicit null first evidence when an expired lease has later evidence", async () => {
    const f = fixture();
    const fetcher = vi.fn(failed);
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    await f.object.fetch(wake(number));
    const persisted = JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!);
    expect(persisted.lastFailureReceipt.firstEvidence).toBeNull();
    persisted.lastFailureReceipt.evidence = { version: 1, attemptedCalls: 1, validatedCalls: 0,
      costState: "reserved_unknown", latestAttempt: null, lastProblem: null, diagnostic: null, checkpointFailures: 0, dropped: 0 };
    await f.storage.put(SCANNER_EXECUTION_STATE_KEY, JSON.stringify(persisted));
    await f.storage.put("active", { start: { id: crypto.randomUUID(), startedAt: new Date(number - 401_000).toISOString() },
      wake: `${number - 401_000}:0 * * * *`, expiresAt: number - 1 });
    fetcher.mockImplementation(healthy);
    expect((await f.object.fetch(wake(number + 1))).status).toBe(200);
    const receipt = parseScannerExecutionState(JSON.parse(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)!))!.lastFailureReceipt!;
    expect(receipt.attempt.diagnostics).toEqual([{ stage: "request", code: "completion_missing" }]);
    expect(receipt.firstAttempt).toEqual(persisted.lastFailureReceipt.firstAttempt);
    expect(receipt.firstEvidence).toBeNull();
    expect(receipt.evidence).toBeNull();
  });
  it("fences a delayed old completion after its lease expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const f = fixture();
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation(() => healthy());
    vi.stubGlobal("fetch", fetcher);
    const number = Date.now();
    const old = f.object.fetch(wake(number));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    vi.setSystemTime(new Date(number + 401_000));
    await f.object.fetch(wake(number + 401_000));
    const saved = String(f.storage.values.get(SCANNER_EXECUTION_STATE_KEY));
    release(healthy());
    expect((await old).status).toBe(503);
    expect(String(f.storage.values.get(SCANNER_EXECUTION_STATE_KEY))).toBe(saved);
    expect(JSON.parse(saved).lastFailureReceipt.attempt.diagnostics).toEqual([{ stage: "request", code: "completion_missing" }]);
  });
  it("fails closed before dispatch on corrupt bootstrap or missing coordinator binding", async () => {
    const f = fixture();
    f.mirror.set(SCANNER_EXECUTION_STATE_KEY, "corrupt private history");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await f.object.fetch(wake())).status).toBe(503);
    await expect(worker.scheduled({ cron: "0 * * * *", scheduledTime: Date.now(), noRetry() {} }, f.env, { waitUntil() {} })).rejects.toThrow("scanner_coordinator_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.email.send).not.toHaveBeenCalled();
    expect(f.mirror.get(SCANNER_EXECUTION_STATE_KEY)).toBe("corrupt private history");
  });
});
