import "server-only";

const RETRY_STATUS = 504;
const RETRY_DELAY_MS = 75;
const MAX_RECOVERY_WINDOW_MS = 12_000;
const MAX_RETRY_ATTEMPT_MS = 6_000;

type FetchImplementation = typeof fetch;

export type SupabaseRestRetryOptions = {
  delayMs?: number;
  maxRecoveryWindowMs?: number;
  maxRetryAttemptMs?: number;
  now?: () => number;
};

type RequestMetadata = {
  url: URL;
  method: string;
  signal: AbortSignal | undefined;
};

function callerAbortError(signal: AbortSignal): Error {
  const error = signal.reason === undefined
    ? new Error("The operation was aborted.")
    : new Error("The operation was aborted.", { cause: signal.reason });
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw callerAbortError(signal);
}

function requestMetadata(input: RequestInfo | URL, init?: RequestInit): RequestMetadata | null {
  try {
    if (input instanceof Request) {
      return {
        url: new URL(input.url),
        method: (init?.method ?? input.method).toUpperCase(),
        signal: init?.signal ?? input.signal ?? undefined,
      };
    }
    return {
      url: new URL(input.toString()),
      method: (init?.method ?? "GET").toUpperCase(),
      signal: init?.signal ?? undefined,
    };
  } catch {
    return null;
  }
}

function isRestTableRead(request: RequestMetadata, supabaseOrigin: string): boolean {
  if ((request.method !== "GET" && request.method !== "HEAD") || request.url.origin !== supabaseOrigin) return false;
  const table = /^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)$/.exec(request.url.pathname)?.[1];
  return table !== undefined && table !== "rpc";
}

function isSdkRetry(input: RequestInfo | URL, init?: RequestInit): boolean {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.has("x-retry-count");
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(callerAbortError(signal!));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function discardAfterRetry(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * Adds one bounded retry for a PostgREST table read that returns HTTP 504.
 * postgrest-js already owns retries for 503, 520, and network errors.
 */
export function createSupabaseRestRetryFetch(
  supabaseUrl: string,
  nativeFetch: FetchImplementation = globalThis.fetch.bind(globalThis),
  options: SupabaseRestRetryOptions = {},
): FetchImplementation {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const delayMs = options.delayMs ?? RETRY_DELAY_MS;
  const maxRecoveryWindowMs = options.maxRecoveryWindowMs ?? MAX_RECOVERY_WINDOW_MS;
  const maxRetryAttemptMs = options.maxRetryAttemptMs ?? MAX_RETRY_ATTEMPT_MS;
  const now = options.now ?? Date.now;

  return async (input, init) => {
    const request = requestMetadata(input, init);
    if (!request || !isRestTableRead(request, supabaseOrigin)) return nativeFetch(input, init);

    throwIfAborted(request.signal);
    const startedAt = now();
    let firstResponse: Response;
    try {
      firstResponse = await nativeFetch(input, init);
    } catch (error) {
      if (request.signal?.aborted) throw callerAbortError(request.signal);
      throw error;
    }
    if (isSdkRetry(input, init)) return firstResponse;
    if (firstResponse.status !== RETRY_STATUS) return firstResponse;

    const remainingMs = maxRecoveryWindowMs - (now() - startedAt);
    if (remainingMs <= delayMs) return firstResponse;

    try {
      await waitForRetry(delayMs, request.signal);
    } catch (error) {
      if (request.signal?.aborted) {
        discardAfterRetry(firstResponse);
        throw callerAbortError(request.signal);
      }
      throw error;
    }

    const retryRemainingMs = maxRecoveryWindowMs - (now() - startedAt);
    if (retryRemainingMs <= 0) return firstResponse;

    const retryTimeoutMs = Math.max(1, Math.floor(Math.min(maxRetryAttemptMs, retryRemainingMs)));
    const timeoutSignal = AbortSignal.timeout(retryTimeoutMs);
    const retrySignal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
    try {
      const retryResponse = await nativeFetch(input, { ...init, signal: retrySignal });
      discardAfterRetry(firstResponse);
      return retryResponse;
    } catch {
      if (request.signal?.aborted) {
        discardAfterRetry(firstResponse);
        throw callerAbortError(request.signal);
      }
      // Keep the original PostgREST 504 body for the caller and prevent the
      // SDK from treating the retry timeout as a new retryable fetch failure.
      return firstResponse;
    }
  };
}
