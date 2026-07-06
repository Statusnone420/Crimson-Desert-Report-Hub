import { NextResponse } from "next/server";
import { insertSkippedScheduledRun, runAutomationMonitor } from "@/lib/automation/run";
import { scheduledScanDecision } from "@/lib/automation/schedule";
import { getAutomationControlState } from "@/lib/automation/settings";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron secret missing" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isVercelPreview()) {
    return NextResponse.json({ error: "preview_writes_disabled" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);
  const { error: purgeError } = await supabase
    .from("source_signals")
    .update({ raw_text: null, raw_expires_at: null })
    .lt("raw_expires_at", new Date().toISOString())
    .not("raw_text", "is", null);

  const now = new Date();
  const control = await getAutomationControlState();
  const minIntervalMinutes =
    Number.isFinite(control.minIntervalMinutes) && control.minIntervalMinutes > 0 ? control.minIntervalMinutes : 60;
  let automation:
    | Awaited<ReturnType<typeof runAutomationMonitor>>
    | { status: "skipped"; reason: string } = { status: "skipped", reason: "recent_run" };
  const { data: recent } = await supabase
    .from("automation_runs")
    .select("mode, status, started_at")
    .gte("started_at", new Date(now.getTime() - minIntervalMinutes * 60 * 1000).toISOString());
  const decision = scheduledScanDecision(
    control.paused,
    (recent ?? []) as { mode: string; status: string; started_at?: string | null }[],
    now,
    minIntervalMinutes,
  );
  if (decision.run) {
    automation = await runAutomationMonitor({ mode: "scheduled", scannerPolicy: control });
  } else {
    automation = { status: "skipped", reason: decision.skipReason };
    await insertSkippedScheduledRun(supabase, decision.skipReason, now);
  }

  return NextResponse.json({
    ok: !touchError && !purgeError,
    touch: touchError?.message ?? "ok",
    purge: purgeError?.message ?? "ok",
    scanner: control,
    automation,
  });
}
