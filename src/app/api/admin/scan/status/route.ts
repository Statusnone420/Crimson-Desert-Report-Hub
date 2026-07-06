import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { sweepStaleRuns } from "@/lib/automation/run";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";

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
    Date.now() - new Date(row.finished_at).getTime() < RECENT_FINISH_WINDOW_MS
  ) {
    revalidatePublicSurfaces();
  }

  return NextResponse.json(row);
}
