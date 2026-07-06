import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { sweepStaleRuns } from "@/lib/automation/run";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type RunStatusRow = {
  id: string;
  status: string;
  mode: string;
  progress: Record<string, unknown> | null;
  skips: string[];
  errors: string[];
  started_at: string;
  finished_at: string | null;
};

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const supabase = createServiceClient();
  await sweepStaleRuns(supabase, new Date());

  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, status, mode, progress, skips, errors, started_at, finished_at")
    .eq("id", id)
    .limit(1);
  if (error) return NextResponse.json({ error: "read_failed" }, { status: 500 });
  const row = ((data ?? []) as RunStatusRow[])[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Belt-and-suspenders: if a manual run just finished, refresh public pages now.
  if (
    row.mode === "manual" &&
    row.status !== "running" &&
    row.finished_at &&
    Date.now() - new Date(row.finished_at).getTime() < 2 * 60 * 1000
  ) {
    try {
      revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
      revalidateTag(PUBLIC_ISSUES_TAG, "max");
      revalidateTag(CURRENT_PATCH_TAG, "max");
      revalidatePath("/");
      revalidatePath("/issues");
    } catch {
      // pages self-revalidate within 5 minutes regardless
    }
  }

  return NextResponse.json(row);
}
