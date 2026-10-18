import { NextResponse } from "next/server";
import { currentScannerExecution, withScannerEssential, withScannerExecution } from "@/lib/automation/executionContext.server";
import { captureMissedContextSnapshots } from "@/lib/automation/contextSnapshots.server";
import { hasCronAuthorization } from "@/lib/cronAuth";
import { scheduleColumnAfterKeepalive } from "@/lib/editorials/hook.server";
import { insertSkippedScheduledRun, runAutomationMonitor } from "@/lib/automation/run";
import { nextEligibleScheduledScanAt, nextScheduledScanAt, scheduledScanDecision } from "@/lib/automation/schedule";
import { getAutomationControlState } from "@/lib/automation/settings";
import { isVercelPreview } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";
import { getScannerAiHealth } from "@/lib/automation/health.server";
import { scannerAiEvidence, type ScannerAiEvidence } from "@/lib/automation/openRouterReadout";
import {
  SCANNER_ATTEMPT_HEADER, describeScannerDiagnostic, parseScannerAttemptContext, parseScannerDiagnostic, scannerAttemptId, scannerDiagnostic,
  type ScannerAttempt, type ScannerStage,
} from "@/lib/automation/diagnostics";

export const maxDuration = 300;

export async function GET(req: Request) {
  const startedAtMs = Date.now();
  const response = await withScannerExecution(() => keepalive(req));
  // State of the Game: runs after this response is sent and never changes it.
  scheduleColumnAfterKeepalive(req, startedAtMs);
  return response;
}
async function keepalive(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron secret missing" }, { status: 500 });
  }
  if (!hasCronAuthorization(req, secret)) {
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
  let aiEvidence: ScannerAiEvidence | null = null;
  let touch = "not_attempted";
  let purge = "not_attempted";
  let statistics: Record<string, number> = {};
  console.info(JSON.stringify({ event: "scanner_request_started", id: attempt.id, startedAt: attempt.startedAt, stage }));
  try {
    const supabase = createServiceClient();
    const probeStartedAt = Date.now();
    const { error: touchError, status: touchStatus } = await supabase.from("issue_clusters").select("id").limit(1);
    console.info(JSON.stringify({ event: "scanner_database_probe", id: attempt.id, status: touchStatus,
      elapsedMs: Date.now() - probeStartedAt }));
    if (touchError) throw { message: touchError.message, code: touchError.code, status: touchStatus };
    touch = "ok";
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
      attempt.persistence = result.persistence;
      if (result.progressWriteFailures?.length) attempt.progressWriteFailures = result.progressWriteFailures;
      if (result.status === "skipped") {
        const reason = result.skips?.find((code) => ["scan_already_running", "paused", "recent_run"].includes(code));
        if (reason) attempt.skipReason = reason as ScannerAttempt["skipReason"];
        if (reason === "scan_already_running" || reason === "paused") attempt.nextEligibleAt = null;
      }
      attempt.diagnostics = (result.diagnostics ?? []).map(parseScannerDiagnostic).filter((item) => item !== null).slice(0, 16);
      attempt.errorCount = result.errors?.length ?? 0;
      // The trigger needs counters and safe codes, never private source text or upstream errors.
      statistics = Object.fromEntries(Object.entries(result).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
      aiEvidence = scannerAiEvidence(result, result.llmCallsUsed, result.skips ?? []);
      attempt.nextEligibleAt = result.status === "skipped" ? attempt.nextEligibleAt : nextScheduledScanAt(now, minIntervalMinutes).toISOString();
      if (attempt.errorCount > 0 || attempt.diagnostics.length > 0) {
        attempt.outcome = result.status === "skipped" || result.status === "failed" ? "failed" : "partial";
      }
      if (attempt.outcome === "failed" || attempt.outcome === "partial") {
        attempt.errorCount = Math.max(1, attempt.errorCount);
        if (!attempt.diagnostics.length) attempt.diagnostics.push({ stage: "scan", code: "operation_failed" });
      }
      attempt.warningOnly = attempt.outcome === "partial" && result.persistence === "recorded"
        && attempt.errorCount === attempt.diagnostics.length && attempt.diagnostics.length > 0
        && attempt.diagnostics.every((item) => ["progress_write", "health_read", "retention", "cache_revalidate", "mapping_cache"].includes(item.stage));
      if (result.status === "success" || result.status === "partial") {
        enterStage("cache_revalidate");
        revalidatePublicSurfaces();
      }
    } else {
      attempt.skipReason = decision.skipReason;
      attempt.outcome = "skipped";
      if (decision.skipReason === "recent_run") {
        // Free Steam and Twitch captures the latest run missed are taken now,
        // instead of waiting for the next paid scan. Never throws. A failed capture
        // is logged and kept on the skip row, and the next scan tries again; it does
        // not raise the wake, so a capture outage sends no extra alert email.
        const capture = await captureMissedContextSnapshots(supabase, runs, now);
        if (capture.errors.length) {
          console.warn(JSON.stringify({ event: "scanner_fallback_capture_failed", id: attempt.id, skips: capture.skips, errors: capture.errors }));
        }
        enterStage("skip_write");
        await insertSkippedScheduledRun(supabase, decision.skipReason, now, capture);
      } else {
        enterStage("skip_write");
        await insertSkippedScheduledRun(supabase, decision.skipReason, now);
      }
    }
    // Do not make another database request after a failure; the Worker retains previous success timestamps.
    if (attempt.outcome !== "failed") {
      enterStage("health_read");
      aiHealth = await withScannerEssential(() => getScannerAiHealth(control!));
      if (aiHealth.code === "ai_history_unavailable") {
        attempt.outcome = "partial";
        attempt.diagnostics.push({ stage, code: "database_unavailable" });
        attempt.errorCount++;
      }
    }
    if (attempt.outcome !== "failed" && Date.now() < currentScannerExecution()!.workDeadlineAtMs - 15_000) {
      enterStage("retention");
      const { error: purgeError } = await supabase.from("source_signals")
        .update({ raw_text: null, raw_expires_at: null }).lt("raw_expires_at", now.toISOString()).not("raw_text", "is", null);
      if (purgeError) {
        purge = "failed";
        attempt.diagnostics.push(scannerDiagnostic(stage, purgeError));
        attempt.errorCount++;
        if (attempt.outcome === "success") { attempt.outcome = "partial"; attempt.warningOnly = attempt.persistence === "recorded"; }
      } else purge = "ok";
    } else purge = "deferred";
  } catch (error) {
    const diagnostic = scannerDiagnostic(stage, error);
    attempt.outcome = ["health_read", "cache_revalidate"].includes(diagnostic.stage) ? "partial" : "failed";
    attempt.diagnostics = [...attempt.diagnostics, diagnostic].slice(-16);
    attempt.errorCount++;
    // A timed-out ledger insert may have committed. Its next eligibility requires a fresh history read.
    if (diagnostic.stage === "run_create") attempt.nextEligibleAt = null;
  }
  attempt.warningOnly = attempt.outcome === "partial" && attempt.persistence === "recorded"
    && attempt.errorCount === attempt.diagnostics.length && attempt.diagnostics.length > 0
    && attempt.diagnostics.every((item) => ["progress_write", "health_read", "retention", "cache_revalidate", "mapping_cache"].includes(item.stage));
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const context = parseScannerAttemptContext({ deploymentSha: deploymentSha && /^[a-f0-9]{40}$/.test(deploymentSha) ? deploymentSha : null,
    modelPreset: control?.modelPreset ?? null, minIntervalMinutes: control?.minIntervalMinutes ?? null,
    monthlyLlmUsdCap: control?.monthlyLlmUsdCap ?? null, monthlyTavilyCreditCap: control?.monthlyTavilyCreditCap ?? null,
    workCounts: statistics });
  if (context) attempt.context = context;
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
    aiEvidence,
    attempt,
  }, { status: attempt.httpStatus });
}
