import { z } from "zod";
import { isAdmin } from "@/lib/adminGuard";
import { problemReportUpdateSchema } from "@/lib/problemReportSchema";
import { problemResponse, problemSameOrigin, readProblemJson } from "@/lib/problemReportHttp.server";
import { ProblemReportsUnavailable, readProblemReport, updateProblemReport } from "@/lib/problemReports.server";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function failed(error: unknown) {
  return problemResponse({ error: error instanceof ProblemReportsUnavailable ? error.reason : "reporting_unavailable" }, 503);
}

export async function GET(_request: Request, context: Context) {
  if (!await isAdmin()) return problemResponse({ error: "unauthorized" }, 401);
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problemResponse({ error: "invalid_request" }, 400);
  if (!hasSupabaseServiceConfig()) return problemResponse({ error: "reporting_unavailable" }, 503);
  try {
    const report = await readProblemReport(createServiceClient(), id);
    return report ? problemResponse({ report }) : problemResponse({ error: "not_found" }, 404);
  } catch (error) { return failed(error); }
}

export async function PATCH(request: Request, context: Context) {
  if (!await isAdmin()) return problemResponse({ error: "unauthorized" }, 401);
  if (isVercelPreview()) return problemResponse({ error: "preview_writes_disabled" }, 403);
  if (!problemSameOrigin(request)) return problemResponse({ error: "invalid_origin" }, 403);
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return problemResponse({ error: "invalid_request" }, 400);
  let body: unknown;
  try { body = await readProblemJson(request); }
  catch (error) { return problemResponse({ error: "invalid_request" }, error instanceof Error && error.message === "json_required" ? 415 : 400); }
  const parsed = problemReportUpdateSchema.safeParse(body);
  if (!parsed.success) return problemResponse({ error: "validation" }, 400);
  if (!hasSupabaseServiceConfig()) return problemResponse({ error: "reporting_unavailable" }, 503);
  try {
    const data = await updateProblemReport(createServiceClient(), id, parsed.data.revision, parsed.data.status, parsed.data.note);
    if (data?.outcome === "not_found") return problemResponse({ error: "not_found" }, 404);
    if (data?.outcome === "conflict") return problemResponse({ error: "conflict" }, 409);
    if (data?.outcome !== "updated") return problemResponse({ error: "save_failed" }, 503);
    return problemResponse(data);
  } catch (error) { return failed(error); }
}
