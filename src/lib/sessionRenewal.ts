export const RENEWAL_RETRY_DELAY_MS = 3_000;

export type RenewalOutcome = "done" | "unavailable";

/**
 * Asks the server to extend a used admin session. A 2xx means renewed or not
 * yet due; a 401 means there is no live session to extend, which the sign-in
 * guard handles on the next request. Anything else, including a network
 * failure, is retried once and then reported as unavailable, never dropped.
 */
export async function renewAdminSession(
  request: () => Promise<Response> = () => fetch("/api/admin/session", { method: "POST", cache: "no-store" }),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<RenewalOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await wait(RENEWAL_RETRY_DELAY_MS);
    const settled = await request().then((response) => response.ok || response.status === 401, () => false);
    if (settled) return "done";
  }
  return "unavailable";
}
