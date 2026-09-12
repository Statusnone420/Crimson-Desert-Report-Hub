import { NextResponse } from "next/server";
import { insertSkippedScheduledRun, runAutomationMonitor } from "@/lib/automation/run";
import { nextEligibleScheduledScanAt, nextScheduledScanAt, scheduledScanDecision } from "@/lib/automation/schedule";
import { getAutomationControlState } from "@/lib/automation/settings";
import { isVercelPreview } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";
import { getScannerAiHealth } from "@/lib/automation/health.server";
import {
  SCANNER_ATTEMPT_HEADER, describeScannerDiagnostic, parseScannerDiagnostic, scannerAttemptId, scannerDiagnostic,
  type ScannerAttempt, type ScannerStage,
} from "@/lib/automation/diagnostics";

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

  const now = new Date();
  const suppliedId = req.headers.get(SCANNER_ATTEMPT_HEADER);
  const attempt: ScannerAttempt = {
    id: scannerAttemptId(suppliedId) ? suppliedId : crypto.randomUUID(),
    startedAt: now.toISOString(), finishedAt: now.toISOString(), outcome: "failed",
    diagnostics: [], errorCount: 0, skipReason: null, nextEligibleAt: null, httpStatus: null,
  };
  let stage: ScannerStage = "database_check";
  const enterStage = (next: ScannerStage) => {
    stage = next;
    console.info(JSON.stringify({ event: "scanner_stage_started", id: attempt.id, stage }));
  };
  let control: Awaited<ReturnType<typeof getAutomationControlState>> | null = null;
  let aiHealth: Awaited<ReturnType<typeof getScannerAiHealth>> | null = null;
  let touch = "not_attempted";
  let purge = "not_attempted";
  let statistics: Record<string, number> = {};
  console.info(JSON.stringify({ event: "scanner_request_started", id: attempt.id, startedAt: attempt.startedAt, stage }));
  try {
    const supabase = createServiceClient();
    const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);
    if (touchError) throw touchError;
    touch = "ok";
    enterStage("retention");
    const { error: purgeError } = await supabase.from("source_signals")
      .update({ raw_text: null, raw_expires_at: null }).lt("raw_expires_at", now.toISOString()).not("raw_text", "is", null);
    if (purgeError) throw purgeError;
    purge = "ok";
    enterStage("policy_read");
    control = await getAutomationControlState();
    const minIntervalMinutes = Number.isFinite(control.minIntervalMinutes) && control.minIntervalMinutes > 0 ? control.minIntervalMinutes : 60;
    enterStage("schedule_read");
    const { data: recent, error: scheduleError } = await supabase.from("automation_runs")
      .select("mode, status, started_at")
      .gte("started_at", new Date(now.getTime() - minIntervalMinutes * 60_000).toISOString());
    if (scheduleError) throw scheduleError;
    const runs = (recent ?? []) as { mode: string; status: string; started_at?: string | null }[];
    const decision = scheduledScanDecision(control.paused, runs, now, minIntervalMinutes);
    attempt.nextEligibleAt = control.paused ? null : nextEligibleScheduledScanAt(runs, now, minIntervalMinutes).toISOString();
    if (decision.run) {
      enterStage("scan");
      const result = await runAutomationMonitor({ mode: "scheduled", scannerPolicy: control, attemptId: attempt.id });
      attempt.outcome = result.status;
      if (result.status === "skipped" && result.skips?.includes("scan_already_running")) {
        attempt.skipReason = "scan_already_running";
        attempt.nextEligibleAt = null;
      }
      attempt.diagnostics = (result.diagnostics ?? []).map(parseScannerDiagnostic).filter((item) => item !== null).slice(0, 16);
      attempt.errorCount = result.errors?.length ?? 0;
      // The trigger needs counters and safe codes, never private source text or upstream errors.
      statistics = Object.fromEntries(Object.entries(result).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
      attempt.nextEligibleAt = result.status === "skipped" ? attempt.nextEligibleAt : nextScheduledScanAt(now, minIntervalMinutes).toISOString();
      if (attempt.errorCount > 0 || attempt.diagnostics.length > 0) {
        attempt.outcome = result.status === "skipped" || result.status === "failed" ? "failed" : "partial";
      }
      if (attempt.outcome === "failed" || attempt.outcome === "partial") {
        attempt.errorCount = Math.max(1, attempt.errorCount);
        if (!attempt.diagnostics.length) attempt.diagnostics.push({ stage: "scan", code: "operation_failed" });
      }
      if (result.status === "success" || result.status === "partial") {
        enterStage("cache_revalidate");
        revalidatePublicSurfaces();
      }
    } else {
      attempt.skipReason = decision.skipReason;
      enterStage("skip_write");
      await insertSkippedScheduledRun(supabase, decision.skipReason, now);
      attempt.outcome = "skipped";
    }
    // Do not make another database request after a failure; the Worker retains previous success timestamps.
    if (attempt.outcome !== "failed") {
      enterStage("health_read");
      aiHealth = await getScannerAiHealth(control);
      if (aiHealth.code === "ai_history_unavailable") {
        attempt.outcome = "partial";
        attempt.diagnostics.push({ stage, code: "database_unavailable" });
        attempt.errorCount++;
      }
    }
  } catch (error) {
    const diagnostic = scannerDiagnostic(stage, error);
    attempt.outcome = ["health_read", "cache_revalidate"].includes(diagnostic.stage) ? "partial" : "failed";
    attempt.diagnostics = [...attempt.diagnostics, diagnostic].slice(-16);
    attempt.errorCount++;
    // A timed-out ledger insert may have committed. Its next eligibility requires a fresh history read.
    if (diagnostic.stage === "run_create") attempt.nextEligibleAt = null;
  }
  attempt.finishedAt = new Date().toISOString();
  attempt.httpStatus = attempt.outcome === "failed" ? 503 : 200;
  console.info(JSON.stringify({ event: "scanner_request_completed", ...attempt }));
  return NextResponse.json({
    ok: attempt.outcome !== "failed" && attempt.outcome !== "partial",
    touch, purge,
    scanner: control,
    automation: { ...statistics, status: attempt.outcome, errors: attempt.diagnostics.map(describeScannerDiagnostic),
      ...(attempt.skipReason ? { reason: attempt.skipReason } : {}) },
    aiHealth,
    attempt,
  }, { status: attempt.httpStatus });
}
