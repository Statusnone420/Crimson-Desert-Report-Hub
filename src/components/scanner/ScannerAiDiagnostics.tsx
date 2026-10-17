import { describeOpenRouterAttempt, scannerAiEvidence, scannerAiEvidenceLines, type ScannerAiEvidence } from "@/lib/automation/openRouterReadout";
import { parseOpenRouterTraceJournal } from "@/lib/automation/openRouterTrace";
import { describeCheckpointWrite } from "@/lib/automation/checkpointWrite";

export function ScannerAiEvidenceReadout({ evidence }: { evidence: ScannerAiEvidence }) {
  return <div className="workspace-note">{scannerAiEvidenceLines(evidence).map((line, index) =>
    <p key={index} style={{ overflowWrap: "anywhere" }}>{line}</p>)}
    <p>Local operation IDs do not prove provider receipt. Fetch does not expose separate DNS, connection or TLS timings.</p>
  </div>;
}

/** Private scanner surfaces only; reconstruct every displayed field. */
export function ScannerAiDiagnostics({ progress, calls, skips }: { progress: unknown; calls: number; skips: string[] }) {
  const evidence = scannerAiEvidence(progress, calls, skips);
  if (!evidence) return null;
  const journal = progress && typeof progress === "object" ? parseOpenRouterTraceJournal((progress as Record<string, unknown>).openRouterTrace) : null;
  return <details className="raw-diagnostics">
    <summary>AI request evidence · {evidence.validatedCalls ?? "unrecorded"} validated</summary>
    <ScannerAiEvidenceReadout evidence={evidence} />
    {journal?.checkpointWriteFailures?.map((failure, index) => <div key={`${failure.operationId}-${failure.phase}-${index}`} className="workspace-field" style={{ overflowWrap: "anywhere" }}>
      <strong>Failed {failure.phase} checkpoint · {describeCheckpointWrite(failure)}</strong>
      <small>Local operation {failure.operationId}</small>
    </div>)}
    {journal?.attempts.map((attempt) => <div key={attempt.id} className="workspace-field" style={{ overflowWrap: "anywhere" }}>
      <strong>{describeOpenRouterAttempt(attempt)}</strong>
      <small>Local operation {attempt.id}{attempt.parentId ? ` · parent ${attempt.parentId}` : ""} · attempt {attempt.attempt}</small>
      <small>Started {attempt.startedAt} · request started {attempt.requestStartedAt ?? "not recorded"} · request deadline {attempt.deadlineAt ?? "not recorded"}</small>
      <small>Checkpoint {attempt.checkpointMs === null ? "completion not recorded" : `${attempt.checkpointMs} ms`} · last observed stage {attempt.stage} · shared deadline {attempt.sharedDeadlineAt ?? "not applicable"}</small>
    </div>)}
  </details>;
}
