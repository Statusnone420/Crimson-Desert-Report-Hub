import { SITE_URL } from "@/lib/site";

export type CaptchaResult = { ok: boolean; skipped: boolean };

type SiteverifyReply = { success?: unknown; action?: unknown; hostname?: unknown; "error-codes"?: unknown };

/**
 * Logs why a token was refused, so a failure on the live site can be traced. It keeps
 * only Cloudflare's reason codes and the action and hostname Cloudflare reports, never
 * the token, the secret or the visitor's IP.
 */
function logRefusal(form: "check_in" | "problem_report", detail: { status?: number; reply?: SiteverifyReply; error?: unknown }) {
  const text = (value: unknown) => typeof value === "string" ? value.slice(0, 100) : typeof value;
  const codes = detail.reply?.["error-codes"];
  console.warn(JSON.stringify({
    event: "turnstile_refused", form,
    ...(detail.status === undefined ? {} : { status: detail.status }),
    ...(detail.reply ? { codes: Array.isArray(codes) ? codes.slice(0, 5).map(text) : [], action: text(detail.reply.action), hostname: text(detail.reply.hostname) } : {}),
    ...(detail.error === undefined ? {} : { error: detail.error instanceof Error ? detail.error.name : typeof detail.error }),
  }));
}

/**
 * Hosts whose pages may show the check-in widget: the public domain, its www alias
 * and Vercel's production domain. They come from configuration, never from the request.
 */
export function turnstileHostnames(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const siteHostname = new URL(SITE_URL).hostname;
  const hostnames = new Set([siteHostname, `www.${siteHostname}`]);
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  if (productionHost && /^[a-z0-9.-]+$/.test(productionHost)) hostnames.add(productionHost);
  return hostnames;
}

/**
 * Verifies a Turnstile token with Cloudflare. A token solved on any other site is
 * refused even when Cloudflare accepts it, so challenges solved elsewhere with the
 * public site key cannot be replayed here.
 */
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<CaptchaResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false };

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    const data = (await res.json()) as SiteverifyReply;
    const ok = data.success === true && typeof data.hostname === "string" && turnstileHostnames().has(data.hostname);
    if (!ok) logRefusal("check_in", { status: res.status, reply: data });
    return { ok, skipped: false };
  } catch (error) {
    logRefusal("check_in", { error });
    return { ok: false, skipped: false };
  }
}

/** Separate invisible widget: strict action, hostname, deadline, and fail-closed configuration. */
export async function verifyProblemReportTurnstile(token: string, requestUrl: string): Promise<boolean> {
  const secret = process.env.PROBLEM_REPORT_TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !token || token.length > 2048) return false;
  const hostnames = turnstileHostnames();
  const requestHostname = new URL(requestUrl).hostname;
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production"
      && ["localhost", "127.0.0.1", "[::1]"].includes(requestHostname)) {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) hostnames.add(host);
  }
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logRefusal("problem_report", { status: response.status });
      return false;
    }
    const data = await response.json();
    const ok = data?.success === true && data.action === "problem_report"
      && typeof data.hostname === "string" && hostnames.has(data.hostname);
    if (!ok) logRefusal("problem_report", { status: response.status, reply: data ?? undefined });
    return ok;
  } catch (error) {
    logRefusal("problem_report", { error });
    return false;
  }
}
