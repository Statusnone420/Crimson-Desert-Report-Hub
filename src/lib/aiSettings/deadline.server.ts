import "server-only";

// The route remains 60s. All offsets start at HTTP handler entry, before auth.
export const AI_TEST_PREFLIGHT_MS = 25_000;
export const AI_TEST_VALIDATION_END_MS = 46_000;
export const AI_TEST_SETTLEMENT_END_MS = 55_000;
export const AI_TEST_RECEIPT_END_MS = 58_000;

/** Race as well as abort: a stalled body or SDK must not consume finalization time. */
export async function beforeAiDeadline<T>(deadlineAt: number, operation: (signal: AbortSignal) => PromiseLike<T>, caller?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const timeout = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new Error("qualification_deadline")); };
    caller?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, Math.max(0, deadlineAt - Date.now()));
  });
  try {
    if (caller?.aborted || Date.now() >= deadlineAt) { cancel(); await timeout; }
    return await Promise.race([timeout, operation(controller.signal)]);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", cancel);
  }
}
