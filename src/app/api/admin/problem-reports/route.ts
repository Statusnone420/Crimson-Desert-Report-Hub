import { z } from "zod";
import { isAdmin } from "@/lib/adminGuard";
import { PROBLEM_REPORT_STATUSES } from "@/lib/problemReports";
import { problemResponse } from "@/lib/problemReportHttp.server";
import { listProblemReports, ProblemReportsUnavailable } from "@/lib/problemReports.server";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const querySchema = z.object({ status: z.enum(PROBLEM_REPORT_STATUSES).optional(), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict();

export async function GET(request: Request) {
  if (!await isAdmin()) return problemResponse({ error: "unauthorized" }, 401);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return problemResponse({ error: "invalid_request" }, 400);
  if (!hasSupabaseServiceConfig()) return problemResponse({ error: "reporting_unavailable" }, 503);
  try { return problemResponse(await listProblemReports(createServiceClient(), parsed.data)); }
  catch (error) { return problemResponse({ error: error instanceof ProblemReportsUnavailable ? error.reason : "read_failed" }, 503); }
}
