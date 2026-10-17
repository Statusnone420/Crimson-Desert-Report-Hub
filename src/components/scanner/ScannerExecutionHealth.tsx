import { formatEasternDateTime, formatRelativeOperatorTime } from "@/lib/automation/runDisplay";
import { describeScannerDiagnostic, scannerDiagnosticAction } from "@/lib/automation/diagnostics";
import {
  getScannerExecutionHealth,
  type ScannerExecutionHealth as ScannerExecutionHealthModel,
} from "@/lib/automation/executionHealth";
import type { ScannerExecutionRead } from "@/lib/automation/diagnostics";
import { ScannerAiEvidenceReadout } from "@/components/scanner/ScannerAiDiagnostics";
import { describeCheckpointWrite } from "@/lib/automation/checkpointWrite";

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
        {execution.state === "available" && execution.snapshot?.latestAiEvidence ? <>
          <p className="mono-label">AI evidence from the latest trigger</p>
          <ScannerAiEvidenceReadout evidence={execution.snapshot.latestAiEvidence} />
        </> : null}
        {execution.state === "available" && execution.snapshot?.lastAiIncident ? <p className="workspace-note" style={{ overflowWrap: "anywhere" }}>
          Retained AI incident reported: {execution.snapshot.lastAiIncident.code} · {timestamp(execution.snapshot.lastAiIncident.reportedAt, nowMs, missing)} · trigger {execution.snapshot.lastAiIncident.attemptId}.
          AI health may refer to an earlier meaningful run; this report time does not establish when the provider failed.
        </p> : null}
        {execution.state === "available" && execution.snapshot?.lastAiIncident?.evidence ? <details className="raw-diagnostics">
          <summary>Retained AI incident evidence</summary>
          <ScannerAiEvidenceReadout evidence={execution.snapshot.lastAiIncident.evidence} />
        </details> : null}
        {health.action ? <p className="op-note">Next action: {health.action}</p> : null}
        {execution.state === "available" && execution.snapshot?.lastFailureReceipt ? <details className="raw-diagnostics">
          <summary>Retained failure receipt</summary>
          <p className="workspace-note">{execution.snapshot.lastFailureReceipt.attempt.warningOnly
            ? "The scan was saved with optional reporting warnings."
            : execution.snapshot.lastFailureReceipt.attempt.persistence === "unconfirmed"
              ? "The completed run save was not confirmed. Reserved spending remains counted."
              : "The scanner recorded an incomplete attempt."}
            {execution.snapshot.lastFailureReceipt.recoveredAt ? ` A later scan recovered at ${execution.snapshot.lastFailureReceipt.recoveredAt}.` : " Recovery has not been verified."}
          </p>
          <p className="workspace-note">Attempt: {execution.snapshot.lastFailureReceipt.attempt.id}</p>
          {execution.snapshot.lastFailureReceipt.attempt.context ? <p className="workspace-note">Deployment: {execution.snapshot.lastFailureReceipt.attempt.context.deploymentSha ?? "not recorded"} · Model: {execution.snapshot.lastFailureReceipt.attempt.context.modelPreset ?? "not recorded"} · Work counts: {JSON.stringify(execution.snapshot.lastFailureReceipt.attempt.context.workCounts)}</p> : null}
          {execution.snapshot.lastFailureReceipt.firstAttempt ? <p className="workspace-note">First affected attempt: {execution.snapshot.lastFailureReceipt.firstAttempt.id}</p> : null}
          {execution.snapshot.lastFailureReceipt.firstAttempt && execution.snapshot.lastFailureReceipt.firstAttempt.id !== execution.snapshot.lastFailureReceipt.attempt.id ? <details className="raw-diagnostics">
            <summary>Original failure facts</summary>
            <p className="workspace-note">Outcome: {execution.snapshot.lastFailureReceipt.firstAttempt.outcome} · Completion: {execution.snapshot.lastFailureReceipt.firstAttempt.persistence ?? "not recorded"}</p>
            {execution.snapshot.lastFailureReceipt.firstAttempt.diagnostics.map((diagnostic, index) => <p className="workspace-note" key={index}>{describeScannerDiagnostic(diagnostic)} {scannerDiagnosticAction(diagnostic)}</p>)}
            {execution.snapshot.lastFailureReceipt.firstAttempt.progressWriteFailures?.map((failure, index) => <p className="workspace-note" key={index}>{failure.runStage}: {describeCheckpointWrite(failure)}</p>)}
            {execution.snapshot.lastFailureReceipt.firstAttempt.context ? <p className="workspace-note">Deployment: {execution.snapshot.lastFailureReceipt.firstAttempt.context.deploymentSha ?? "not recorded"} · Model: {execution.snapshot.lastFailureReceipt.firstAttempt.context.modelPreset ?? "not recorded"} · Work counts: {JSON.stringify(execution.snapshot.lastFailureReceipt.firstAttempt.context.workCounts)}</p> : null}
          </details> : null}
          {execution.snapshot.lastFailureReceipt.firstEvidence ? <details className="raw-diagnostics"><summary>First failure evidence</summary>
            <ScannerAiEvidenceReadout evidence={execution.snapshot.lastFailureReceipt.firstEvidence} /></details> : null}
          {execution.snapshot.lastFailureReceipt.attempt.progressWriteFailures?.map((failure, index) => <p key={index} className="workspace-note">{failure.runStage}: {describeCheckpointWrite(failure)}</p>)}
          {execution.snapshot.lastFailureReceipt.evidence ? <ScannerAiEvidenceReadout evidence={execution.snapshot.lastFailureReceipt.evidence} /> : null}
        </details> : null}
        {execution.state === "available" && execution.snapshot?.alertDelivery ? <p className="workspace-note">Notification delivery: {execution.snapshot.alertDelivery.state === "sent" ? "acknowledged" : "unconfirmed; automatic resend is disabled"}.</p> : null}
      </div>
    </section>
  );
}
