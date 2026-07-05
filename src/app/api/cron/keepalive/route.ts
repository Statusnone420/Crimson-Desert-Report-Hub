import { NextResponse } from "next/server";
import { runAutomationMonitor } from "@/lib/automation/run";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);
  const { error: purgeError } = await supabase
    .from("source_signals")
    .update({ raw_text: null, raw_expires_at: null })
    .lt("raw_expires_at", new Date().toISOString())
    .not("raw_text", "is", null);

  let automation: Awaited<ReturnType<typeof runAutomationMonitor>> | { status: "skipped"; reason: string } = {
    status: "skipped",
    reason: "recent_run",
  };
  const { data: recent } = await supabase
    .from("automation_runs")
    .select("started_at")
    .gte("started_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1);
  if ((recent ?? []).length === 0) {
    automation = await runAutomationMonitor({ mode: "scheduled" });
  }

  return NextResponse.json({
    ok: !touchError && !purgeError,
    touch: touchError?.message ?? "ok",
    purge: purgeError?.message ?? "ok",
    automation,
  });
}
