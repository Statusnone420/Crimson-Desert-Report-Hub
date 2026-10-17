import { createHash } from "node:crypto";
import { hashIp, ipNetwork } from "@/lib/crypto";
import { problemReportSchema } from "@/lib/problemReportSchema";
import { problemPageUrl, problemResponse, problemSameOrigin, readProblemJson } from "@/lib/problemReportHttp.server";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import { verifyProblemReportTurnstile } from "@/lib/turnstile";

export async function POST(request: Request) {
  if (isVercelPreview()) return problemResponse({ error: "preview_writes_disabled" }, 403);
  if (!problemSameOrigin(request)) return problemResponse({ error: "invalid_origin" }, 403);
  let body: unknown;
  try { body = await readProblemJson(request); }
  catch (error) { return problemResponse({ error: "invalid_request" }, error instanceof Error && error.message === "json_required" ? 415 : 400); }
  const parsed = problemReportSchema.safeParse(body);
  if (!parsed.success) return problemResponse({ error: "validation" }, 400);
  const pageUrl = problemPageUrl(parsed.data.page_url, request.url);
  if (!pageUrl) return problemResponse({ error: "validation" }, 400);
  const salt = process.env.PROBLEM_REPORT_IP_SALT?.trim();
  if (!hasSupabaseServiceConfig() || !salt || salt.length < 32
    || !process.env.PROBLEM_REPORT_TURNSTILE_SECRET_KEY?.trim()
    || !process.env.NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY?.trim()) {
    return problemResponse({ error: "reporting_unavailable" }, 503);
  }
  // Match the site's existing trusted-proxy boundary. The host must overwrite
  // this header; never expose the origin behind a proxy that forwards spoofed IPs.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const network = ip ? ipNetwork(ip) : null;
  if (!network) return problemResponse({ error: "reporting_unavailable" }, 503);
  if (!await verifyProblemReportTurnstile(parsed.data.turnstile_token, request.url)) {
    return problemResponse({ error: "captcha_failed" }, 400);
  }
  try {
    const { data, error } = await createServiceClient().rpc("record_site_problem_report", {
      p_type: parsed.data.type, p_description: parsed.data.description, p_page_url: pageUrl,
      p_email: parsed.data.email, p_ip_hash: hashIp(network, salt),
      // Siteverify accepted one real token repeatedly in local checks. The
      // database refuses a second report for the same token hash.
      p_token_hash: createHash("sha256").update(parsed.data.turnstile_token).digest("hex"),
    });
    if (error) return problemResponse({ error: isMissingSupabaseRpc(error, "record_site_problem_report") ? "reporting_unavailable" : "save_failed" }, 503);
    if (data?.outcome === "rate_limited") {
      return problemResponse({ error: "rate_limited" }, 429, { "Retry-After": String(data.retry_after) });
    }
    if (data?.outcome === "replayed") return problemResponse({ error: "captcha_failed" }, 400);
    if (data?.outcome !== "created") return problemResponse({ error: "save_failed" }, 503);
    return problemResponse({ ok: true }, 201);
  } catch { return problemResponse({ error: "save_failed" }, 503); }
}
