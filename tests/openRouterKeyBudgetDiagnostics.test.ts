import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateOpenRouterKeyBudget, readOpenRouterKeyBudget } from "@/lib/automation/budget";
import { appendOpenRouterDiagnostics, type OpenRouterDiagnostic } from "@/lib/automation/openRouterDiagnostics";

type KeyBudgetFetcher = NonNullable<Parameters<typeof readOpenRouterKeyBudget>[1]>;

const valid = { limit: 1, limit_remaining: 0.75, limit_reset: "monthly", usage_monthly: 0.25 };
const localBudget = { monthlyLlmUsdCap: 0.5, remainingLlmUsd: 0.5 };
const privateMarker = "PRIVATE-KEY-BODY-ERROR-MUST-NOT-SURVIVE";
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });

afterEach(() => vi.useRealTimers());

describe("OpenRouter key budget diagnostics", () => {
  it.each([false, true])("reports the two-second timeout (headers received: %s) once, even after late completion", async (headersReceived) => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    let complete!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => { complete = resolve; });
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<KeyBudgetFetcher>(async (_url, init) => {
      signal = init.signal;
      if (!headersReceived) await body;
      return { ok: true, status: 200, json: () => body };
    });
    const pending = readOpenRouterKeyBudget(privateMarker, fetcher, (item) => diagnostics.push(item));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([{
      code: "key_budget_timeout", elapsedMs: 2_000, httpStatus: headersReceived ? 200 : null, attempts: 1,
    }]);
    complete({ data: valid });
    await vi.runAllTimersAsync();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("key_budget_timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 429, 503])("records HTTP %s without reading the response body or retrying", async (status) => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const json = vi.fn(async () => ({ error: privateMarker }));
    const fetcher = vi.fn(async () => ({ ok: false, status, json }));
    expect(await readOpenRouterKeyBudget(privateMarker, fetcher, (item) => diagnostics.push(item))).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([{ code: "key_budget_http_failure", elapsedMs: expect.any(Number), httpStatus: status, attempts: 1 }]);
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it.each([false, true])("distinguishes transport and decoding exceptions (decoding: %s)", async (decoding) => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fail = async () => { await new Promise((resolve) => setTimeout(resolve, 23)); throw new Error(privateMarker); };
    const pending = readOpenRouterKeyBudget(privateMarker, decoding
      ? async () => ({ ok: true, status: 200, json: fail }) : fail, (item) => diagnostics.push(item));
    await vi.advanceTimersByTimeAsync(23);
    expect(await pending).toBeNull();
    expect(diagnostics).toEqual([{
      code: decoding ? "key_budget_decode_failure" : "key_budget_transport_failure",
      elapsedMs: 23, httpStatus: decoding ? 200 : null, attempts: 1,
    }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it.each(["limit", "limit_remaining", "limit_reset", "usage_monthly"] as const)("reports missing and invalid %s without retaining values", async (field) => {
    for (const value of [undefined, privateMarker, -1, Number.NaN, Infinity, {}]) {
      const diagnostics: OpenRouterDiagnostic[] = [];
      const snapshot = await readOpenRouterKeyBudget(privateMarker, async () => response({ ...valid, [field]: value, label: privateMarker }), (item) => diagnostics.push(item));
      expect(snapshot).toBeNull();
      expect(evaluateOpenRouterKeyBudget(snapshot, localBudget).skipReason).toBe("openrouter_key_budget_unverified");
      expect(diagnostics[0]).toMatchObject({ code: "key_budget_validation_failure", httpStatus: 200, attempts: 1,
        keyBudgetValidation: { [field]: value === undefined ? "missing" : "invalid" } });
      expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
    }
  });

  it.each([null, [], "invalid", {}])("records absent budget fields for an unusable data envelope: %j", async (data) => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    expect(await readOpenRouterKeyBudget(privateMarker, async () => response(data), (item) => diagnostics.push(item))).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: "key_budget_validation_failure", keyBudgetValidation: {
      limit: "missing", limit_remaining: "missing", limit_reset: "missing", usage_monthly: "missing", remainingWithinLimit: null,
    } });
  });

  it.each([
    [{ ...valid, limit_remaining: null }, "openrouter_key_budget_unverified", null],
    [{ ...valid, limit_remaining: 1.1 }, "openrouter_key_budget_unverified", false],
    [{ ...valid, limit: null, limit_remaining: null, limit_reset: null }, "openrouter_key_limit_unsafe", null],
    [{ ...valid, limit_reset: "daily" }, "openrouter_key_limit_unsafe", true],
    [{ ...valid, limit_reset: "weekly" }, "openrouter_key_limit_unsafe", true],
    [{ ...valid, limit: 2 }, "openrouter_key_limit_unsafe", true],
    [{ ...valid, limit_remaining: 0 }, "llm_budget_capped", true],
    [{ ...valid, usage_monthly: 0.5 }, "llm_budget_capped", true],
    [{ ...valid, limit_reset: null, usage_monthly: 0 }, null, true],
  ])("preserves the gate for %j", async (data, reason, remainingWithinLimit) => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const snapshot = await readOpenRouterKeyBudget(privateMarker, async () => response(data), (item) => diagnostics.push(item));
    expect(evaluateOpenRouterKeyBudget(snapshot, localBudget).skipReason).toBe(reason);
    expect(diagnostics[0]).toMatchObject({ code: "key_budget_response_parsed", keyBudgetValidation: { remainingWithinLimit } });
  });

  it("distinguishes null monthly usage from a verified zero and missing local credentials", async () => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    expect(await readOpenRouterKeyBudget(privateMarker, async () => response({ ...valid, usage_monthly: null }), (item) => diagnostics.push(item))).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: "key_budget_validation_failure", keyBudgetValidation: { usage_monthly: "null" } });
    const fetcher = vi.fn();
    const reporter = vi.fn();
    expect(await readOpenRouterKeyBudget("  ", fetcher, reporter)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(reporter).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not let a failing diagnostic sink alter the budget (async: %s)", async (asyncSink) => {
    const fail = () => { throw new Error(privateMarker); };
    const snapshot = await readOpenRouterKeyBudget(privateMarker, async () => response(valid), asyncSink ? async () => fail() : fail);
    expect(evaluateOpenRouterKeyBudget(snapshot, localBudget)).toEqual({ remainingLlmUsd: 0.25, skipReason: null });
  });

  it("reconstructs nested validation fields and rejects injected diagnostic data", () => {
    const diagnostic = { code: "key_budget_validation_failure", elapsedMs: 10, httpStatus: 200, attempts: 1,
      authorization: privateMarker, response: privateMarker,
      keyBudgetValidation: { limit: "valid", limit_remaining: "invalid", limit_reset: "null", usage_monthly: "missing", remainingWithinLimit: null, raw: privateMarker },
    } as unknown as OpenRouterDiagnostic;
    const clean = appendOpenRouterDiagnostics(undefined, [diagnostic]);
    expect(clean).toEqual([{ code: diagnostic.code, elapsedMs: 10, httpStatus: 200, attempts: 1,
      keyBudgetValidation: { limit: "valid", limit_remaining: "invalid", limit_reset: "null", usage_monthly: "missing", remainingWithinLimit: null },
    }]);
    expect(JSON.stringify(clean)).not.toContain(privateMarker);
    const polluted = { ...diagnostic, keyBudgetValidation: { ...diagnostic.keyBudgetValidation, limit: privateMarker } } as unknown as OpenRouterDiagnostic;
    expect(appendOpenRouterDiagnostics(undefined, [polluted])[0]).not.toHaveProperty("keyBudgetValidation");
    expect(appendOpenRouterDiagnostics(undefined, [{ ...diagnostic, code: "request_timeout" }])[0]).not.toHaveProperty("keyBudgetValidation");
    expect(appendOpenRouterDiagnostics(undefined, Array(40).fill(diagnostic))).toHaveLength(32);
  });
});
