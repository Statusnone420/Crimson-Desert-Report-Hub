import { SITE_URL } from "@/lib/site";

export type CaptchaResult = { ok: boolean; skipped: boolean };

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
    const data = (await res.json()) as { success?: boolean; hostname?: unknown };
    const ok = data.success === true && typeof data.hostname === "string" && turnstileHostnames().has(data.hostname);
    return { ok, skipped: false };
  } catch {
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
    if (!response.ok) return false;
    const data = await response.json();
    return data?.success === true && data.action === "problem_report"
      && typeof data.hostname === "string" && hostnames.has(data.hostname);
  } catch { return false; }
}
