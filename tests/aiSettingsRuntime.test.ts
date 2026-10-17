import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConfiguration, AiProfile } from "@/lib/aiSettings/types";
import { aiRuntimeFingerprint, aiRuntimeForBudget, applyAiRuntimeOptions, attachAiRuntime, loadAiRuntime, managedScannerPolicy } from "@/lib/aiSettings/runtime.server";
import { computeAutomationBudget } from "@/lib/automation/budget";
import { normalizeScannerPolicy } from "@/lib/automation/settings";
import { applyAutomationBudgetCeiling } from "@/lib/automation/budgetState.server";
import type { OpenRouterAttempt } from "@/lib/automation/openRouterTrace";

const now = new Date("2026-10-02T12:00:00.000Z");
const profile: AiProfile = { provider: "openrouter", modelId: "fixture/primary", reasoning: "default", retention: "standard", maxOutputTokens: 1_024,
  connectionVersion: 0, metadata: { provider: "openrouter", id: "fixture/primary", name: "Fixture", contextWindow: 32_768,
    maxOutputTokens: 4_096, inputModalities: ["text"], outputModalities: ["text"], supportedParameters: ["max_tokens", "response_format", "structured_outputs"],
    reasoning: false, reasoningEfforts: null, reasoningRequired: null, structuredOutput: true, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2,
    pricingSource: "provider", pricingSupported: true, pricingIssue: null, fetchedAt: now.toISOString() } };
const backup: AiProfile = { ...profile, modelId: "fixture/backup", metadata: { ...profile.metadata, id: "fixture/backup" } };
const configuration: AiConfiguration = { revision: 1, active: profile, previous: null, backup, policy: { monthlyUsd: 50, requestUsd: 0.005, recovery: "backup" } };
type Row = Record<string, unknown>;
function fixture(config: unknown = configuration, options: { missing?: boolean; error?: string; events?: Row[]; tested?: boolean; connection?: Row } = {}) {
  const inserted: Row[] = [];
  const queries: { table: string; limit: number }[] = [];
  const from = vi.fn((table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query, gte: () => query, order: () => query,
      limit: async (limit: number) => {
        queries.push({ table, limit });
        if (options.error === table) return { data: null, error: { code: "42501", message: "PRIVATE PERMISSION DETAIL" } };
        if (table === "ai_settings_state") return options.missing ? { data: null,
          error: { code: "PGRST205", message: "Could not find the table 'public.ai_settings_state' in the schema cache" } } :
          { data: [{ revision: 1, configuration: config }], error: null };
        if (table === "ai_connections") return { data: options.connection ? [options.connection] : [], error: null };
        if (table === "ai_settings_events") return { data: options.events ?? [], error: null };
        if (table === "ai_model_tests") return { data: options.tested === false ? [] : [{ profile: backup, result: { passed: true, costState: "verified" } }], error: null };
        throw new Error("Unexpected fixture query");
      },
      insert: async (row: Row) => { if (options.error === "insert") return { error: { message: "PRIVATE" } }; inserted.push(row); return { error: null }; },
    };
    return query;
  });
  return { client: { from } as unknown as Parameters<typeof loadAiRuntime>[0], from, inserted, queries };
}
function event(hoursAgo: number, action = "ai_request_failure", selected = profile): Row {
  return { action, detail: JSON.stringify({ fingerprint: aiRuntimeFingerprint(selected), code: action === "ai_request_failure" ? "http_failure" : "success" }),
    created_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString() };
}
function attempt(outcome: OpenRouterAttempt["outcome"]): OpenRouterAttempt {
  return { id: "11111111-1111-4111-8111-111111111111", parentId: null, operation: "extraction", attempt: 1,
    startedAt: now.toISOString(), requestStartedAt: now.toISOString(), deadlineAt: null, sharedDeadlineAt: null,
    stage: "validation", outcome, elapsedMs: 1, checkpointMs: 0, headersAfterMs: 0, bodyAfterMs: 1,
    httpStatus: outcome === "success" ? 200 : 503, errorClass: null, costState: "verified" };
}
beforeEach(() => { vi.stubEnv("OPENROUTER_API_KEY", "private-environment-fixture-key"); vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0.5"); });
afterEach(() => vi.unstubAllEnvs());

describe("managed scanner runtime", () => {
  it("preserves legacy behavior only for the exact missing table or no active profile", async () => {
    for (const f of [fixture(configuration, { missing: true }), fixture({ ...configuration, active: null })]) {
      expect(await loadAiRuntime(f.client, now)).toBeNull();
      expect(f.from).toHaveBeenCalledOnce();
    }
  });
  it.each(["ai_settings_state", "ai_connections", "ai_settings_events"])("blocks and surfaces %s read errors", async (error) => {
    const f = fixture(configuration, { error });
    const runtime = await loadAiRuntime(f.client, now);
    expect(runtime?.blockedReason).toBe("ai_settings_unavailable");
    expect(runtime?.apply({ llmCallsRemaining: 3 })).toMatchObject({ apiKey: "", llmCallsRemaining: 0 });
    expect(JSON.stringify(runtime)).not.toMatch(/PRIVATE|private-environment-fixture-key/);
  });
  it("never falls back to the environment when an active saved connection cannot be decrypted", async () => {
    const f = fixture(configuration, { connection: { version: 1, ciphertext: "invalid" } });
    const runtime = await loadAiRuntime(f.client, now);
    expect(runtime?.blockedReason).toBe("ai_settings_unavailable");
    expect(runtime?.apply({ llmCallsRemaining: 3 }).apiKey).toBe("");
  });
  it("blocks a stale connection version or unsupported active profile", async () => {
    const stale = await loadAiRuntime(fixture({ ...configuration, active: { ...profile, connectionVersion: 1 } }).client, now);
    expect(stale?.blockedReason).toBe("ai_connection_changed");
    const incompatible = await loadAiRuntime(fixture({ ...configuration, active: { ...profile, metadata: { ...profile.metadata, structuredOutput: false } } }).client, now);
    expect(incompatible?.blockedReason).toBe("ai_settings_unavailable");
  });
  it("keeps credentials outside runtime/budget JSON and only raises a verified managed allowance", async () => {
    const runtime = (await loadAiRuntime(fixture().client, now))!;
    const legacy = normalizeScannerPolicy({ monthlyLlmUsdCap: 1, aiManaged: true });
    expect(legacy).not.toHaveProperty("aiManaged");
    expect(applyAutomationBudgetCeiling(legacy).monthlyLlmUsdCap).toBe(0.5);
    const policy = applyAutomationBudgetCeiling(managedScannerPolicy(legacy, runtime));
    expect(policy.monthlyLlmUsdCap).toBe(50);
    const budget = computeAutomationBudget({ monthlyBudgetUsd: 50, spentMonthToDateUsd: 0, now, scannerPolicy: policy });
    attachAiRuntime(budget, runtime);
    expect(aiRuntimeForBudget(budget)).toBe(runtime);
    expect(JSON.stringify({ budget, runtime })).not.toContain("private-environment-fixture-key");
    const options = runtime.apply({ llmCallsRemaining: 3, llmBudgetRemainingUsd: 10 });
    expect(options).toMatchObject({ apiKey: "private-environment-fixture-key", configuredModel: profile, llmBudgetRemainingUsd: 0.005 });
    expect(applyAiRuntimeOptions(budget, { llmCallsRemaining: 3 })).toHaveProperty("configuredModel", profile);
  });
  it("selects only a tested backup on a later scan after two consecutive failures", async () => {
    const f = fixture(configuration, { events: [event(0.5), event(1), event(2, "ai_request_success")] });
    const runtime = await loadAiRuntime(f.client, now);
    expect(runtime?.profile?.modelId).toBe(backup.modelId);
    expect(f.queries).toContainEqual({ table: "ai_settings_events", limit: 30 });
    expect(f.inserted).toEqual([]);
  });
  it.each([
    [event(0.5)], [event(0.5, "ai_request_success"), event(1)], [event(4), event(5)], [event(-1), event(0.5)],
    [event(25), event(26)], [event(0.5, "ai_request_failure", backup), event(1, "ai_request_failure", backup)],
  ])("keeps or rechecks the primary for history %j", async (...events) => {
    const runtime = await loadAiRuntime(fixture(configuration, { events }).client, now);
    expect(runtime?.profile?.modelId).toBe(profile.modelId);
  });
  it("ignores failover when disabled, its receipt is absent, or the cost circuit is open", async () => {
    const events = [event(0.5), event(1)];
    expect((await loadAiRuntime(fixture({ ...configuration, policy: { ...configuration.policy, recovery: "next_scan" } }, { events }).client, now))?.profile).toEqual(profile);
    expect((await loadAiRuntime(fixture(configuration, { events, tested: false }).client, now))?.profile).toEqual(profile);
    const blocked = await loadAiRuntime(fixture(configuration, { events }).client, now, true);
    expect(blocked?.profile).toEqual(profile);
    expect(blocked?.apply({ llmCallsRemaining: 3 }).llmCallsRemaining).toBe(0);
  });
  it("stops after the first failure, retains that failure after a success, and records one bounded event", async () => {
    const f = fixture();
    const runtime = (await loadAiRuntime(f.client, now))!;
    const originalReporter = vi.fn();
    const options = runtime.apply({ llmCallsRemaining: 3, onAttempt: originalReporter });
    await options.onAttempt?.(attempt("http_failure"));
    expect(runtime.failed).toBe(true);
    expect(runtime.apply({ llmCallsRemaining: 3 }).llmCallsRemaining).toBe(0);
    await options.onAttempt?.(attempt("success"));
    await runtime.record({ llmCallsUsed: 2, llmSucceeded: 1, skips: [] });
    await runtime.record({ llmCallsUsed: 2, llmSucceeded: 1, skips: [] });
    expect(originalReporter).toHaveBeenCalledTimes(2);
    expect(f.inserted).toEqual([{ action: "ai_request_failure", detail: JSON.stringify({ fingerprint: aiRuntimeFingerprint(profile), code: "http_failure" }) }]);
  });
  it("records no healthy recovery for a skipped scan, and exposes event write failures", async () => {
    const skipped = fixture();
    await (await loadAiRuntime(skipped.client, now))!.record({ llmCallsUsed: 0, skips: ["llm_budget_capped"] });
    expect(skipped.inserted).toEqual([]);
    const failedWrite = fixture(configuration, { error: "insert" });
    const runtime = (await loadAiRuntime(failedWrite.client, now))!;
    await expect(runtime.record({ llmCallsUsed: 1, llmSucceeded: 1, skips: [] })).rejects.toThrow("ai_settings_unavailable");
  });
  it("does not turn an unrelated source-accounting failure into a model failover signal", async () => {
    const f = fixture();
    const runtime = (await loadAiRuntime(f.client, now))!;
    await runtime.apply({ llmCallsRemaining: 1, onAttempt: vi.fn() }).onAttempt?.(attempt("success"));
    await runtime.record({ llmCallsUsed: 1, llmSucceeded: 1, skips: ["settlement_unacknowledged"] });
    expect(f.inserted).toEqual([]);
  });
});
