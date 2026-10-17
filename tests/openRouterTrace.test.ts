import { afterEach, describe, expect, it, vi } from "vitest";
import { readOpenRouterKeyBudget, resolveOpenRouterCostUsd } from "@/lib/automation/budget";
import { extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";
import { OpenRouterAttemptTrace, parseOpenRouterAttempt, parseOpenRouterCheckpointFailure, parseOpenRouterTraceJournal, recordOpenRouterCheckpointFailure, upsertOpenRouterAttempt, type OpenRouterAttempt } from "@/lib/automation/openRouterTrace";
import { scannerAiEvidence, parseScannerAiEvidence, scannerAiEvidenceLines } from "@/lib/automation/openRouterReadout";
import { scannerAiHealth } from "@/lib/automation/health";

const secret = "INVENTED-PRIVATE-KEY-PROMPT-BODY-ERROR";
const keyData = { limit: 1, limit_remaining: 0.75, limit_reset: "monthly", usage_monthly: 0.25 };
const candidate = { title: "Map crash", snippet: secret, url: "https://example.test/private" };
const content = JSON.stringify({ issueTitle: "Map crash", category: "crash_startup", platform: "pc_steam", confidence: "medium",
  summary: "Map crashes.", clusterAssignment: "unsure", clusterReason: "Insufficient context", clusterSlug: null });
const answer = () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0 }, choices: [{ message: { content } }] }) });
const options = { env: { OPENROUTER_API_KEY: secret }, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded private OpenRouter request journal", () => {
  it("does not infer verified cost from a counter and budget diagnostic alone", () => {
    const evidence = scannerAiEvidence({ openRouterDiagnostics: [{ code: "key_budget_response_parsed", elapsedMs: 1, httpStatus: 200, attempts: 1 }] }, 1, []);
    expect(evidence?.costState).toBe("unknown");
    expect(scannerAiEvidenceLines(evidence!).join(" ")).not.toContain("Recorded AI cost verified");
  });
  it("awaits a durable start before dispatch, then records headers/body and verified completion", async () => {
    const records: OpenRouterAttempt[] = [];
    let checkpointComplete = false;
    const fetcher = vi.fn(async () => {
      expect(checkpointComplete).toBe(true);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ operation: "extraction", stage: "checkpoint", outcome: "pending" });
      return answer();
    });
    const result = await extractSignalWithOpenRouter(candidate, { ...options, fetcher, onAttempt: async (item) => {
      await Promise.resolve(); records.push(item); checkpointComplete = true;
    } });
    expect(result.extractionProvider).toBe("openrouter");
    expect(result.llmCallsUsed).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ outcome: "success", httpStatus: 200, costState: "verified", errorClass: null });
    expect(records[1].requestStartedAt).not.toBeNull();
    expect(records[1].headersAfterMs).not.toBeNull();
    expect(records[1].bodyAfterMs).toBeGreaterThanOrEqual(records[1].headersAfterMs!);
    expect(Date.parse(records[1].deadlineAt!) - Date.parse(records[1].requestStartedAt!)).toBe(20_000);
    expect(JSON.stringify(records)).not.toMatch(/INVENTED-PRIVATE|example\.test|choices|authorization|generation/);
  });

  it.each([false, true])("records unchanged key deadline and ignores late completion (headers: %s)", async (headers) => {
    vi.useFakeTimers();
    const records: OpenRouterAttempt[] = [];
    let complete!: (value: unknown) => void;
    const pendingBody = new Promise<unknown>((resolve) => { complete = resolve; });
    const read = readOpenRouterKeyBudget(secret, async () => {
      if (!headers) await pendingBody;
      return { ok: true, status: 200, json: () => pendingBody };
    }, undefined, (item) => { records.push(item); });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await read).toBeNull();
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ outcome: "timeout", httpStatus: headers ? 200 : null, errorClass: "timeout", bodyAfterMs: null });
    expect(Date.parse(records[1].deadlineAt!) - Date.parse(records[1].requestStartedAt!)).toBe(2_000);
    const retained = JSON.stringify(records);
    complete({ data: keyData });
    await vi.runAllTimersAsync();
    expect(JSON.stringify(records)).toBe(retained);
  });

  it.each(["ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET"])("retains only the known transport class for %s", async (code) => {
    const records: OpenRouterAttempt[] = [];
    const result = await extractSignalWithOpenRouter(candidate, { ...options,
      fetcher: async () => { throw new TypeError(secret, { cause: { code, url: secret, authorization: secret } }); },
      onAttempt: (item) => { records.push(item); },
    });
    expect(result.fallbackReason).toBe("openrouter_cost_unverified");
    expect(result.llmCallsUsed).toBe(1);
    expect(records[1].errorClass).toBe(code === "ENOTFOUND" ? "dns" : code === "ECONNRESET" ? "connection" : "connect");
    expect(records[1].outcome).toBe("transport_failure");
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it("observes body decoding separately from transport and preserves unknown-cost reservation", async () => {
    const records: OpenRouterAttempt[] = [];
    const result = await extractSignalWithOpenRouter(candidate, { ...options,
      fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(secret); } }),
      onAttempt: (item) => { records.push(item); },
    });
    expect(result.llmCallsUsed).toBe(1);
    expect(result.llmCostUsd).toBeGreaterThan(0);
    expect(records[1]).toMatchObject({ outcome: "decode_failure", stage: "body", httpStatus: 200, bodyAfterMs: null, costState: "reserved_unknown", errorClass: "decode" });
  });

  it("links the existing generation GET to its local parent, without persisting the provider ID", async () => {
    const records: OpenRouterAttempt[] = [];
    const parent = crypto.randomUUID();
    const cost = await resolveOpenRouterCostUsd({ id: secret }, secret,
      async () => ({ ok: true, status: 200, json: async () => ({ data: { total_cost: 0 } }) }),
      undefined, undefined, 200, (item) => { records.push(item); }, parent);
    expect(cost).toBe(0);
    expect(records[1]).toMatchObject({ operation: "cost_audit", parentId: parent, outcome: "success", costState: "verified" });
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it("does not let a failed sink change a verified result or add paid calls", async () => {
    const fetcher = vi.fn(async () => answer());
    const result = await extractSignalWithOpenRouter(candidate, { ...options, fetcher, onAttempt: async () => { throw new Error(secret); } });
    expect(result.extractionProvider).toBe("openrouter");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains bounded start and terminal checkpoint failures independently of verified AI completion", async () => {
    const records: OpenRouterAttempt[] = [];
    const trace = new OpenRouterAttemptTrace("extraction", 1, (item) => { records.push(item); });
    await trace.start(); trace.fetchStarted(20_000); trace.headers(200); trace.body(); await trace.finish("success", "verified");
    const evidence = { reason: "local_deadline" as const, elapsedMs: 1_001, timeoutMs: 1_000, requests: 1, httpStatus: null, databaseCode: null };
    let journal = recordOpenRouterCheckpointFailure(upsertOpenRouterAttempt(undefined, records[0]), records[0], evidence);
    journal = upsertOpenRouterAttempt(journal, records[1]);
    for (let index = 0; index < 25; index++) journal = recordOpenRouterCheckpointFailure(journal, records[1], evidence);
    expect(journal.checkpointFailures).toBe(26);
    expect(journal.checkpointWriteFailures).toHaveLength(20);
    expect(journal.checkpointWriteFailures?.[0].phase).toBe("start");
    expect(journal.checkpointWriteFailures?.at(-1)?.phase).toBe("terminal");
    expect(journal.attempts[0]).toMatchObject({ outcome: "success", costState: "verified" });
    const summary = scannerAiEvidence({ openRouterTrace: journal, llmSucceeded: 1 }, 1, []);
    expect(summary).toMatchObject({ costState: "verified", lastProblem: null,
      lastCheckpointWrite: { operationId: trace.id, phase: "terminal", reason: "local_deadline" } });
    const polluted = { ...summary, lastCheckpointWrite: { ...summary?.lastCheckpointWrite, cause: secret, url: secret } };
    expect(parseScannerAiEvidence(polluted)).toEqual(summary);
    expect(scannerAiEvidenceLines(summary!).join(" ")).toContain("app deadline expired (limit 1000 ms)");
    expect(scannerAiEvidenceLines(summary!).join(" ")).toContain("does not prove that the database rejected or rolled back");
  });

  it("rejects unbounded or arbitrary failed-write fields while preserving historical AI evidence", async () => {
    const records: OpenRouterAttempt[] = [];
    await new OpenRouterAttemptTrace("extraction", 1, (item) => { records.push(item); }).start();
    const journal = upsertOpenRouterAttempt(undefined, records[0]);
    const valid = { operationId: records[0].id, phase: "terminal", reason: "response_error", elapsedMs: 30,
      timeoutMs: 1_000, requests: 1, httpStatus: 403, databaseCode: "42501" };
    expect(parseOpenRouterCheckpointFailure({ ...valid, message: secret, cause: { code: secret } })).toEqual(valid);
    for (const change of [{ operationId: secret }, { phase: secret }, { reason: ["local_deadline"] },
      { elapsedMs: 180_001 }, { requests: 3 }, { httpStatus: 0 }, { databaseCode: ["42501"] }, { databaseCode: secret }]) {
      expect(parseOpenRouterCheckpointFailure({ ...valid, ...change })).toBeNull();
      expect(parseOpenRouterTraceJournal({ ...journal, checkpointWriteFailures: [{ ...valid, ...change }] })).toEqual(journal);
    }
    expect(parseOpenRouterTraceJournal({ ...journal, checkpointWriteFailures: Array(21).fill(valid) })).toEqual(journal);
    const legacy = scannerAiEvidence({ openRouterTrace: { ...journal, checkpointFailures: 3 }, llmSucceeded: 0 }, 0, []);
    expect(scannerAiEvidenceLines(legacy!).join(" ")).toContain("phase and cause were not recorded");
  });

  it.each(["extraction", "claim_mapping"] as const)("records an unchanged before-headers timeout for %s without retrying unknown cost", async (operation) => {
    vi.useFakeTimers();
    const records: OpenRouterAttempt[] = [];
    const fetcher = vi.fn(() => new Promise<never>(() => {}));
    const traced = { ...options, fetcher, onAttempt: (item: OpenRouterAttempt) => { records.push(item); } };
    const result = operation === "extraction" ? extractSignalWithOpenRouter(candidate, traced) :
      mapClaimToClusterWithOpenRouter({ fixText: "Map crash fix", category: "crash_startup" },
        [{ id: "fixture", slug: "map", title: "Map", category: "crash_startup" }], traced);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ llmCallsUsed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(records[1]).toMatchObject({ operation, outcome: "timeout", stage: "fetch", httpStatus: null, costState: "reserved_unknown" });
  });

  it("labels a verified extraction over its ceiling as budget exceeded, preserving the existing fallback", async () => {
    const records: OpenRouterAttempt[] = [];
    const result = await extractSignalWithOpenRouter(candidate, { ...options,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0.9 }, choices: [{ message: { content } }] }) }),
      onAttempt: (item) => { records.push(item); },
    });
    expect(result.fallbackReason).toBe("openrouter_budget_exceeded");
    expect(result.llmCallsUsed).toBe(1);
    expect(records[1]).toMatchObject({ outcome: "budget_exceeded", costState: "verified" });
  });

  it("preserves first failure, recent attempts, dropped count and nested redaction", async () => {
    const records: OpenRouterAttempt[] = [];
    const trace = new OpenRouterAttemptTrace("extraction", 1, (item) => { records.push(item); });
    await trace.start(); trace.fetchStarted(20_000); await trace.finish("timeout");
    const first = records[1];
    let journal = upsertOpenRouterAttempt(undefined, first);
    for (let index = 0; index < 25; index++) journal = upsertOpenRouterAttempt(journal, { ...first, id: crypto.randomUUID(), outcome: "success", costState: "verified" });
    expect(journal.attempts).toHaveLength(20);
    expect(journal.attempts[0]).toEqual(first);
    expect(journal.dropped).toBe(6);
    const polluted = { ...journal, authorization: secret, attempts: journal.attempts.map((item) => ({ ...item, response: secret, cause: { code: secret } })) };
    expect(parseOpenRouterTraceJournal(polluted)).toEqual(journal);
    expect(parseOpenRouterAttempt({ ...first, errorClass: secret })).toBeNull();
    expect(parseOpenRouterTraceJournal({ ...journal, attempts: [...journal.attempts, first] })).toBeNull();
    const evidence = scannerAiEvidence({ openRouterTrace: polluted, llmSucceeded: 1 }, 1, ["openrouter_cost_unverified"]);
    expect(evidence?.costState).toBe("reserved_unknown");
    expect(JSON.stringify(parseScannerAiEvidence({ ...evidence, raw: secret }))).not.toContain(secret);
    expect(parseScannerAiEvidence({ ...evidence, costState: ["verified"] })).toBeNull();
    expect(scannerAiEvidenceLines(evidence!).join(" ")).toContain("provider completion/charge is unverified");
  });

  it("keeps a completed run with unfinished inference unavailable across idle scans", async () => {
    const records: OpenRouterAttempt[] = [];
    await new OpenRouterAttemptTrace("extraction", 1, (item) => { records.push(item); }).start();
    const journal = upsertOpenRouterAttempt(undefined, records[0]);
    const health = scannerAiHealth([
      { started_at: "2026-09-30T14:00:00Z", status: "success", mode: "scheduled", skips: [], llm_calls_used: 1, progress: { llmSucceeded: 1 } },
      { started_at: "2026-09-30T16:00:00Z", status: "failed", mode: "scheduled", skips: [], llm_calls_used: 0, progress: { llmSucceeded: 0, openRouterTrace: journal } },
      { started_at: "2026-09-30T17:00:00Z", status: "success", mode: "scheduled", skips: [], llm_calls_used: 0 },
    ]);
    expect(health).toMatchObject({ state: "unavailable", code: "ai_completion_unverified", lastSuccessAt: "2026-09-30T14:00:00Z" });
  });
});
