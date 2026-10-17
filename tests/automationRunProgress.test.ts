import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { persistRunProgress, type RunProgressRetryOptions } from "@/lib/automation/runProgress.server";
import type { RunProgress } from "@/lib/automation/run";
import type { ScanIntent } from "@/lib/automation/memory";

vi.mock("server-only", () => ({}));

const supabaseUrl = "https://project.supabase.co";
const runId = "214ff53e-dc69-4792-90b0-ea074a137685";

const payload: { progress: RunProgress; intent: ScanIntent } = {
  progress: {
    stage: "screening",
    searchesDone: 1,
    searchTotal: 3,
    candidatesSeen: 2,
    prefilterRejected: 1,
    llmCallsUsed: 0,
    kept: 0,
    promoted: 0,
    diagnostics: [{ stage: "progress_write", code: "database_timeout" }],
  },
  intent: "broad_discovery",
};

function response(status: number, code = "PGRST003") {
  return new Response(JSON.stringify({ message: `HTTP ${status}`, details: "private", hint: "", code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(nativeFetch: typeof fetch) {
  return createClient(supabaseUrl, "service-role", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: nativeFetch },
  });
}

function options(overrides: RunProgressRetryOptions = {}): RunProgressRetryOptions {
  return { delayMs: 0, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("persistRunProgress", () => {
  it.each([false, true])("bounds a stalled checkpoint including its retry (retry: %s)", async (retry) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const nativeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      signals.push(init!.signal!);
      if (retry && signals.length === 1) return response(504);
      // Even an adapter that ignores abort must not hold up the scanner.
      return new Promise<Response>(() => {});
    });
    const pending = persistRunProgress(client(nativeFetch), runId, payload, { timeoutMs: 1_000 });
    const rejected = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await rejected).toMatchObject({ checkpoint: {
      reason: "local_deadline", elapsedMs: 1_000, timeoutMs: 1_000,
      requests: retry ? 2 : 1, httpStatus: retry ? 504 : null, databaseCode: retry ? "PGRST003" : null,
    } });
    expect(nativeFetch).toHaveBeenCalledTimes(retry ? 2 : 1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not retry a late 504 after a checkpoint has timed out", async () => {
    vi.useFakeTimers();
    let complete!: (response: Response) => void;
    const nativeFetch = vi.fn<typeof fetch>(() => new Promise((resolve) => { complete = resolve; }));
    const pending = persistRunProgress(client(nativeFetch), runId, payload, { timeoutMs: 1_000 });
    const rejected = expect(pending).rejects.toThrow("checkpoint timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    complete(response(504));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it.each([[403, "42501"], [500, "57014"], [500, "PRIVATE-CODE"]])("distinguishes a returned HTTP %s error from the local deadline", async (status, code) => {
    const nativeFetch = vi.fn<typeof fetch>(async () => response(status as number, code as string));
    await expect(persistRunProgress(client(nativeFetch), runId, payload, { timeoutMs: 1_000 }))
      .rejects.toMatchObject({ checkpoint: {
        reason: "response_error", timeoutMs: 1_000, requests: 1,
        httpStatus: status, databaseCode: code === "PRIVATE-CODE" ? null : code,
      } });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("distinguishes a checkpoint transport failure without retaining its message", async () => {
    const nativeFetch = vi.fn<typeof fetch>(async () => { throw new TypeError("PRIVATE-TRANSPORT-ERROR"); });
    const error = await persistRunProgress(client(nativeFetch), runId, payload, { timeoutMs: 1_000 }).catch((error) => error);
    expect(error.checkpoint).toMatchObject({ reason: "transport_error", requests: 1, httpStatus: null, databaseCode: null });
    expect(JSON.stringify(error.checkpoint)).not.toContain("PRIVATE");
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("retries one 504 with the same fenced PATCH and resolves when it recovers", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const nativeFetch = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ input, init });
      return calls.length === 1 ? response(504) : new Response(null, { status: 204 });
    });

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options())).resolves.toBeUndefined();

    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(calls.map(({ input }) => new URL(input.toString()).pathname)).toEqual([
      "/rest/v1/automation_runs",
      "/rest/v1/automation_runs",
    ]);
    for (const call of calls) {
      const url = new URL(call.input.toString());
      expect(url.searchParams.get("id")).toBe(`eq.${runId}`);
      expect(url.searchParams.get("status")).toBe("eq.running");
      expect(call.init?.method).toBe("PATCH");
      expect(JSON.parse(String(call.init?.body))).toEqual(payload);
      expect(new Headers(call.init?.headers).has("x-retry-count")).toBe(false);
    }
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: "scanner_progress_recovery", id: runId, stage: "screening",
      outcome: "recovered", initialStatus: 504, status: 204,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("stops after a second 504 and logs only safe recovery metadata", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const nativeFetch = vi.fn<typeof fetch>(async () => response(504));

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options()))
      .rejects.toMatchObject({ status: 504, code: "PGRST003" });

    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: "scanner_progress_recovery", id: runId, stage: "screening",
      outcome: "failed", initialStatus: 504, status: 504,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("uses the final HTTP error after a second HTTP failure", async () => {
    const nativeFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(504, "INITIAL"))
      .mockResolvedValueOnce(response(500, "FINAL"));

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options())).rejects.toMatchObject({ status: 500, code: "FINAL" });
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the original 504 when the retry loses transport", async () => {
    const nativeFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(504))
      .mockRejectedValueOnce(new Error("connection dropped"));

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options())).rejects.toMatchObject({ status: 504, code: "PGRST003" });
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [500, "57014"],
    [503, "PGRST003"],
    [520, "PGRST003"],
  ])("does not retry HTTP %s, including a statement-timeout body code", async (status, code) => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response(status, code));

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options())).rejects.toMatchObject({ code });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("does not retry a first transport failure", async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection dropped"));

    await expect(persistRunProgress(client(nativeFetch), runId, payload, options())).rejects.toMatchObject({ message: "Error: connection dropped" });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("reuses a cloned payload when the caller mutates its input after the first attempt", async () => {
    const requestPayload = structuredClone(payload);
    const nativeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      if (nativeFetch.mock.calls.length === 1) {
        requestPayload.progress.candidatesSeen = 99;
        return response(504);
      }
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      return new Response(null, { status: 204 });
    });

    await expect(persistRunProgress(client(nativeFetch), runId, requestPayload, options())).resolves.toBeUndefined();
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("does not start a late retry after the recovery window", async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response(504));
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(12_000);

    await expect(persistRunProgress(client(nativeFetch), runId, payload, {
      delayMs: 250,
      maxRecoveryWindowMs: 12_000,
      now,
    })).rejects.toMatchObject({ code: "PGRST003" });
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("aborts the bounded retry and preserves the initial failure", async () => {
    vi.useFakeTimers();
    const nativeFetch = vi.fn<typeof fetch>((_input, init) => {
      if (nativeFetch.mock.calls.length === 1) return Promise.resolve(response(504));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });

    const pending = persistRunProgress(client(nativeFetch), runId, payload, {
      delayMs: 250,
      maxRetryAttemptMs: 100,
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(nativeFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).rejects.toMatchObject({ code: "PGRST003" });
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });
});
