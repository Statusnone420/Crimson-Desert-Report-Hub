import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { sweepStaleRuns } from "@/lib/automation/run";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";
import { isVercelPreview } from "@/lib/previewGuard";
import { scannerDiagnostic, type ScannerStage } from "@/lib/automation/diagnostics";

export const dynamic = "force-dynamic";

// Covers the poll gap around the POST-side after() revalidation: if that
// callback dies with the serverless instance, a status poll seen shortly
// after the run finishes still refreshes the public pages.
const RECENT_FINISH_WINDOW_MS = 2 * 60 * 1000;

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

  let stage: ScannerStage = "database_check";
  try {
    const supabase = createServiceClient();
    stage = "stale_run_cleanup";
    if (!isVercelPreview()) await sweepStaleRuns(supabase, new Date());

    stage = "schedule_read";
    const { data, error } = await supabase
      .from("automation_runs")
      .select("id, status, mode, progress, skips, errors, started_at, finished_at")
      .eq("id", id)
      .limit(1);
    if (error) throw error;
    const row = ((data ?? []) as RunStatusRow[])[0];
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // If the completion callback died, a recent manual status poll still refreshes the public pages.
    if (
      !isVercelPreview() &&
      row.mode === "manual" &&
      row.status !== "running" &&
      row.finished_at &&
      Date.now() - new Date(row.finished_at).getTime() < RECENT_FINISH_WINDOW_MS
    ) {
      stage = "cache_revalidate";
      revalidatePublicSurfaces();
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: "read_failed", diagnostic: scannerDiagnostic(stage, error) }, { status: 500 });
  }
}
