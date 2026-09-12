import { formatEasternDateTime, formatRelativeOperatorTime } from "@/lib/automation/runDisplay";
import { describeScannerDiagnostic, scannerDiagnosticAction } from "@/lib/automation/diagnostics";
import {
  getScannerExecutionHealth,
  type ScannerExecutionHealth as ScannerExecutionHealthModel,
} from "@/lib/automation/executionHealth";
import type { ScannerExecutionRead } from "@/lib/automation/diagnostics";

function toneClass(tone: ScannerExecutionHealthModel["tone"]): string {
  if (tone === "ok") return "workspace-badge--green";
  if (tone === "danger") return "workspace-badge--red";
  return "workspace-badge--amber";
}

function timestamp(iso: string | null, nowMs: number, missing: string): string {
  if (!iso) return missing;
  return `${formatRelativeOperatorTime(iso, nowMs)} · ${formatEasternDateTime(iso)}`;
}

function policyEligibility(eligibleAt: string | null, nowMs: number): string {
  if (!eligibleAt) return "Policy eligibility is unavailable because the scanner policy read did not finish.";
  if (Date.parse(eligibleAt) <= nowMs) return "Policy eligibility: Eligible now.";
  return `Policy eligibility: ${timestamp(eligibleAt, nowMs, "Not available from this read")}.`;
}

export function ScannerExecutionHealth({
  execution,
  nowIso,
  policyEligibleAt,
  policyPaused = false,
}: {
  execution: ScannerExecutionRead;
  nowIso: string;
  policyEligibleAt?: string | null;
  policyPaused?: boolean;
}) {
  const now = new Date(nowIso);
  const health = getScannerExecutionHealth(execution, now);
  const nowMs = now.getTime();
  const retainedDiagnostic = health.lastFailure?.diagnostics[0];
  const missing = health.executionReadAvailable ? "No record" : "Not available from this read";
  const hasRecordedFacts = Boolean(health.currentAttemptId || health.lastSuccessfulScanAt || health.lastSuccessfulAiAt);
  const verifiedSnapshotEligibility = execution.state === "available"
    ? health.latestAttempt?.nextEligibleAt ?? null
    : null;
  const effectiveEligibility = policyEligibleAt ?? verifiedSnapshotEligibility;
  const policyDetail = policyPaused
    ? "Scanner policy is paused."
    : policyEligibility(effectiveEligibility, nowMs);
  const attemptOutcome = health.currentAttemptOutcome
    ? `Outcome: ${health.currentAttemptOutcome}.`
    : health.currentAttemptStartedAt
      ? "Outcome: completion not recorded yet."
      : "Outcome: not available from this read.";
  const attemptHttpStatus = health.currentAttemptHttpStatus === null
    ? "HTTP status: not recorded."
    : `HTTP status: ${health.currentAttemptHttpStatus}.`;

  return (
    <section className="workspace-panel" aria-labelledby="scanner-execution-health-title">
      <div className="workspace-panel-header workspace-toolbar">
        <div>
          <h2 id="scanner-execution-health-title">Scheduled execution evidence</h2>
          <p>Private trigger evidence is separate from scanner policy and Supabase run history.</p>
        </div>
        <span className={`workspace-badge ${toneClass(health.tone)}`}>{health.statusLabel}</span>
      </div>
      <div className="workspace-panel-body">
        <p className="workspace-note">{health.detail}</p>
        <div className="workspace-grid scanner-health-grid">
          {hasRecordedFacts ? <>
            <div className="workspace-field"><span>Current or latest trigger</span><strong style={{ overflowWrap: "anywhere" }}>{health.currentAttemptId ?? missing}</strong><small>Started: {timestamp(health.currentAttemptStartedAt, nowMs, missing)} · Completed: {timestamp(health.currentAttemptFinishedAt, nowMs, missing)} · {attemptOutcome} {attemptHttpStatus}</small></div>
            <div className="workspace-field"><span>Last successful scheduled scan</span><strong>{timestamp(health.lastSuccessfulScanAt, nowMs, missing)}</strong><small>Completion recorded by the trigger status store.</small></div>
            <div className="workspace-field"><span>Last successful AI</span><strong>{timestamp(health.lastSuccessfulAiAt, nowMs, missing)}</strong><small>AI success is separate from complete scanner health.</small></div>
          </> : null}
          <div className={`workspace-field${hasRecordedFacts ? "" : " workspace-field--wide"}`}><span>Next hourly trigger opportunity</span><strong>{timestamp(health.nextHourlyTriggerAt, nowMs, "Not scheduled")}</strong><small>This is an hourly opportunity, not a guarantee of a scan. {policyDetail}</small></div>
        </div>
        {(health.statusLabel === "Trigger running" || health.statusLabel === "Trigger completion missing") && health.observedStartAt ? <p className="workspace-note">Latest observed trigger start: {timestamp(health.observedStartAt, nowMs, missing)}</p> : null}
        {health.lastFailure ? <p className="workspace-note">Retained last failure: {health.lastFailure.id} · {health.lastFailure.outcome} · {timestamp(health.lastFailure.finishedAt, nowMs, missing)}{retainedDiagnostic ? ` · ${describeScannerDiagnostic(retainedDiagnostic)} Next action: ${scannerDiagnosticAction(retainedDiagnostic)}` : " · The retained record has no further safe diagnostic."}</p> : null}
        {health.action ? <p className="op-note">Next action: {health.action}</p> : null}
      </div>
    </section>
  );
}
