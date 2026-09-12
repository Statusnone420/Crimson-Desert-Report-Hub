import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseRestRetryFetch } from "@/lib/supabaseRestRetry";

vi.mock("server-only", () => ({}));

const supabaseUrl = "https://project.supabase.co";
const tableUrl = `${supabaseUrl}/rest/v1/issue_clusters?select=id`;

function retryFetch(
  nativeFetch: typeof fetch,
  options: Parameters<typeof createSupabaseRestRetryFetch>[2] = { delayMs: 0 },
) {
  return createSupabaseRestRetryFetch(supabaseUrl, nativeFetch, options);
}

describe("Supabase REST 504 recovery", () => {
  it("retries one configured-origin table GET after a 504 and cancels the discarded body", async () => {
    let cancelled = false;
    const first = new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { status: 504 });
    const second = new Response('[{"id":"ok"}]', { status: 200 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await expect(retryFetch(nativeFetch)(tableUrl)).resolves.toBe(second);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(true);
  });

  it("preserves the final 504 response after the single extra attempt", async () => {
    const first = new Response("first timeout", { status: 504 });
    const final = new Response("Gateway Timeout", { status: 504 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(first).mockResolvedValueOnce(final);

    await expect(retryFetch(nativeFetch)(tableUrl)).resolves.toBe(final);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("caps a real PostgREST GET at the initial 504 plus its bounded retry timeout", async () => {
    vi.useFakeTimers();
    try {
      const first = new Response(JSON.stringify({ message: "Gateway Timeout", details: null, hint: null, code: "PGRST003" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      });
      let callCount = 0;
      const nativeFetch = vi.fn<typeof fetch>((_input, init) => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve(first);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      });
      const client = createClient(supabaseUrl, "service-role", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: retryFetch(nativeFetch, { delayMs: 75, maxRetryAttemptMs: 100 }) },
      });

      const pending = client.from("issue_clusters").select("id").then((result) => result);
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeFetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(75);
      expect(nativeFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(100);

      const result = await pending;
      expect(nativeFetch).toHaveBeenCalledTimes(2);
      expect(result.error).toMatchObject({ message: "Gateway Timeout", code: "PGRST003" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets PostgREST apply only its own bounded 503 retries after a 504 retry", async () => {
    vi.useFakeTimers();
    try {
      const nativeFetch = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ message: "Service Unavailable", details: null, hint: null, code: "PGRST003" }),
        { status: 503, headers: { "content-type": "application/json" } },
      )));
      nativeFetch.mockResolvedValueOnce(new Response(
        JSON.stringify({ message: "Gateway Timeout", details: null, hint: null, code: "PGRST003" }),
        { status: 504, headers: { "content-type": "application/json" } },
      ));
      const client = createClient(supabaseUrl, "service-role", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: retryFetch(nativeFetch, { delayMs: 0 }) },
      });

      const pending = client.from("issue_clusters").select("id").then((result) => result);
      await vi.advanceTimersByTimeAsync(0);
      expect(nativeFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(7_000);

      const result = await pending;
      expect(nativeFetch).toHaveBeenCalledTimes(5);
      expect(new Headers(nativeFetch.mock.calls[1]?.[1]?.headers).has("x-retry-count")).toBe(false);
      expect(new Headers(nativeFetch.mock.calls[2]?.[1]?.headers).get("x-retry-count")).toBe("1");
      expect(new Headers(nativeFetch.mock.calls[3]?.[1]?.headers).get("x-retry-count")).toBe("2");
      expect(new Headers(nativeFetch.mock.calls[4]?.[1]?.headers).get("x-retry-count")).toBe("3");
      expect(result.error).toMatchObject({ message: "Service Unavailable", code: "PGRST003" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the SDK-owned 503 behavior untouched", async () => {
    const response = new Response("Service Unavailable", { status: 503 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(retryFetch(nativeFetch)(tableUrl)).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("does not retry RPCs, writes, non-REST services, or other origins", async () => {
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("Gateway Timeout", { status: 504 }));
    const wrapped = retryFetch(nativeFetch);

    await wrapped(`${supabaseUrl}/rest/v1/rpc/mutating_read`, { method: "GET" });
    await wrapped(`${supabaseUrl}/rest/v1/issue_clusters/nested`, { method: "GET" });
    for (const method of ["POST", "PATCH", "DELETE"]) await wrapped(tableUrl, { method, body: method === "DELETE" ? undefined : "{}" });
    await wrapped(`${supabaseUrl}/auth/v1/token`, { method: "GET" });
    await wrapped(`${supabaseUrl}/storage/v1/object/private/checkpoint`, { method: "GET" });
    await wrapped("https://provider.example/read", { method: "GET" });

    expect(nativeFetch).toHaveBeenCalledTimes(8);
  });

  it("keeps a five-second 504 eligible for recovery", async () => {
    const first = new Response("Gateway Timeout", { status: 504 });
    const second = new Response("ok", { status: 200 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(5_200);

    await expect(retryFetch(nativeFetch, { delayMs: 0, now: clock })(tableUrl)).resolves.toBe(second);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry after the recovery window and leaves that response readable", async () => {
    const response = new Response("Gateway Timeout", { status: 504 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(12_000);

    const result = await retryFetch(nativeFetch, { delayMs: 75, now: clock })(tableUrl);
    expect(result).toBe(response);
    await expect(result.text()).resolves.toBe("Gateway Timeout");
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("does not start its retry when the recovery window expires during the delay", async () => {
    const response = new Response("Gateway Timeout", { status: 504 });
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10).mockReturnValueOnce(151);

    const result = await retryFetch(nativeFetch, {
      delayMs: 0,
      maxRecoveryWindowMs: 150,
      now: clock,
    })(tableUrl);

    expect(result).toBe(response);
    expect(nativeFetch).toHaveBeenCalledOnce();
  });

  it("honors abort before the first request and while waiting to retry", async () => {
    const before = new AbortController();
    const beforeReason = new Error("cancel before request");
    before.abort(beforeReason);
    const preflightFetch = vi.fn<typeof fetch>();
    await expect(retryFetch(preflightFetch)(tableUrl, { signal: before.signal })).rejects.toMatchObject({
      name: "AbortError",
      cause: beforeReason,
    });
    expect(preflightFetch).not.toHaveBeenCalled();

    const initial = new AbortController();
    const initialReason = new Error("cancel initial request");
    const initialFetch = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const initialPending = retryFetch(initialFetch)(tableUrl, { signal: initial.signal });
    await vi.waitFor(() => expect(initialFetch).toHaveBeenCalledOnce());
    initial.abort(initialReason);
    await expect(initialPending).rejects.toMatchObject({ name: "AbortError", cause: initialReason });
    expect(initialFetch).toHaveBeenCalledOnce();

    const sdkReplay = new AbortController();
    const sdkReplayReason = new Error("cancel SDK replay");
    const sdkReplayFetch = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const sdkReplayPending = retryFetch(sdkReplayFetch)(tableUrl, {
      headers: { "x-retry-count": "1" },
      signal: sdkReplay.signal,
    });
    await vi.waitFor(() => expect(sdkReplayFetch).toHaveBeenCalledOnce());
    sdkReplay.abort(sdkReplayReason);
    await expect(sdkReplayPending).rejects.toMatchObject({ name: "AbortError", cause: sdkReplayReason });
    expect(sdkReplayFetch).toHaveBeenCalledOnce();

    const during = new AbortController();
    const duringReason = new Error("cancel during retry delay");
    const first = new Response("Gateway Timeout", { status: 504 });
    const delayedFetch = vi.fn<typeof fetch>().mockResolvedValue(first);
    const pending = retryFetch(delayedFetch, { delayMs: 1_000 })(tableUrl, { signal: during.signal });
    await vi.waitFor(() => expect(delayedFetch).toHaveBeenCalledOnce());
    during.abort(duringReason);
    await expect(pending).rejects.toMatchObject({ name: "AbortError", cause: duringReason });
    expect(delayedFetch).toHaveBeenCalledOnce();
  });

  it("does not let caller aborts replay a real PostgREST request during delay or retry", async () => {
    const delayController = new AbortController();
    const delayFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("Gateway Timeout", { status: 504 }));
    const delayClient = createClient(supabaseUrl, "service-role", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: retryFetch(delayFetch, { delayMs: 1_000 }) },
    });
    const delayPending = delayClient.from("issue_clusters").select("id").abortSignal(delayController.signal).then((result) => result);
    await vi.waitFor(() => expect(delayFetch).toHaveBeenCalledOnce());
    delayController.abort(new Error("caller delay cancellation"));
    await delayPending;
    expect(delayFetch).toHaveBeenCalledOnce();

    const retryController = new AbortController();
    let retryCalls = 0;
    const retryFetchImpl = vi.fn<typeof fetch>((_input, init) => {
      retryCalls += 1;
      if (retryCalls === 1) return Promise.resolve(new Response("Gateway Timeout", { status: 504 }));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const retryClient = createClient(supabaseUrl, "service-role", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: retryFetch(retryFetchImpl, { delayMs: 0 }) },
    });
    const retryPending = retryClient.from("issue_clusters").select("id").abortSignal(retryController.signal).then((result) => result);
    await vi.waitFor(() => expect(retryFetchImpl).toHaveBeenCalledTimes(2));
    retryController.abort(new Error("caller retry cancellation"));
    await retryPending;
    expect(retryFetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves a Request object and its HEAD semantics across the retry", async () => {
    const request = new Request(tableUrl, { method: "HEAD", headers: { "x-request-id": "read-1" } });
    const nativeFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await retryFetch(nativeFetch)(request);

    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(nativeFetch.mock.calls[0]?.[0]).toBe(request);
    expect(nativeFetch.mock.calls[1]?.[0]).toBe(request);
    expect(new Request(nativeFetch.mock.calls[1]?.[0] as Request).method).toBe("HEAD");
    expect(new Request(nativeFetch.mock.calls[1]?.[0] as Request).headers.get("x-request-id")).toBe("read-1");
  });
});
