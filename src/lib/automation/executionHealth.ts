import {
  describeScannerDiagnostic,
  nextHourlyScannerWake,
  scannerDiagnosticAction,
  type ScannerAttempt,
  type ScannerDiagnostic,
  type ScannerExecutionRead,
} from "@/lib/automation/diagnostics";

const COMPLETION_GRACE_MS = 6 * 60 * 1000;
const HEARTBEAT_OVERDUE_MS = 90 * 60 * 1000;

export type ScannerExecutionHealthTone = "ok" | "caution" | "danger" | "unavailable";

export type ScannerExecutionHealth = {
  tone: ScannerExecutionHealthTone;
  statusLabel: string;
  detail: string;
  action: string | null;
  needsAttention: boolean;
  latestAttempt: ScannerAttempt | null;
  latestAttemptAt: string | null;
  observedStartAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastSuccessfulAiAt: string | null;
  lastFailure: ScannerAttempt | null;
  nextHourlyTriggerAt: string;
  currentAttemptId: string | null;
  currentAttemptStartedAt: string | null;
  currentAttemptFinishedAt: string | null;
  currentAttemptOutcome: ScannerAttempt["outcome"] | null;
  currentAttemptHttpStatus: number | null;
  executionReadAvailable: boolean;
};

function currentAttempt(read: ScannerExecutionRead): {
  id: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: ScannerAttempt["outcome"] | null;
  httpStatus: number | null;
} {
  const latest = read.snapshot?.latestAttempt ?? null;
  if (isNewerStart(read)) {
    return {
      id: read.started!.id,
      startedAt: read.started!.startedAt,
      finishedAt: null,
      outcome: null,
      httpStatus: null,
    };
  }
  return latest
    ? {
        id: latest.id,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt,
        outcome: latest.outcome,
        httpStatus: latest.httpStatus,
      }
    : { id: null, startedAt: null, finishedAt: null, outcome: null, httpStatus: null };
}

function common(read: ScannerExecutionRead, nextHourlyTriggerAt: string) {
  const snapshot = read.snapshot;
  const attempt = currentAttempt(read);
  return {
    latestAttempt: snapshot?.latestAttempt ?? null,
    latestAttemptAt: snapshot?.latestAttempt.finishedAt ?? null,
    observedStartAt: read.started?.startedAt ?? null,
    lastSuccessfulScanAt: snapshot?.lastSuccessfulScanAt ?? null,
    lastSuccessfulAiAt: snapshot?.lastSuccessfulAiAt ?? null,
    lastFailure: snapshot?.lastFailedAttempt ?? null,
    nextHourlyTriggerAt,
    currentAttemptId: attempt.id,
    currentAttemptStartedAt: attempt.startedAt,
    currentAttemptFinishedAt: attempt.finishedAt,
    currentAttemptOutcome: attempt.outcome,
    currentAttemptHttpStatus: attempt.httpStatus,
    executionReadAvailable: read.state === "available" || read.state === "no_attempt",
  };
}

function diagnosticDetail(diagnostic: ScannerDiagnostic | undefined): {
  detail: string;
  action: string | null;
} {
  if (!diagnostic) {
    return {
      detail: "The trigger recorded a non-success outcome without a more specific safe diagnostic.",
      action: "Inspect the attempt in the private runtime logs before the next trigger.",
    };
  }
  return { detail: describeScannerDiagnostic(diagnostic), action: scannerDiagnosticAction(diagnostic) };
}

function unavailable(
  read: ScannerExecutionRead,
  nextHourlyTriggerAt: string,
): ScannerExecutionHealth {
  const statusLabel = read.state === "not_configured"
    ? "Execution evidence not configured"
    : read.state === "no_attempt"
      ? "No execution recorded"
      : read.state === "preview"
        ? "Preview execution evidence"
        : read.code === "invalid_response"
          ? "Execution evidence malformed"
          : read.code === "access_denied" || read.code === "admin_required"
            ? "Execution evidence access unavailable"
            : "Execution evidence unavailable";
  const detail = read.state === "no_attempt"
    ? "The execution record was read successfully, but no scheduled trigger has recorded an attempt yet."
    : read.state === "preview"
      ? "Preview execution evidence does not verify the production scanner."
      : read.detail;
  return {
    tone: "unavailable",
    statusLabel,
    detail,
    action: read.state === "no_attempt"
      ? "Check the next hourly trigger after the schedule is enabled."
      : "Restore the execution-record read, then check the next hourly trigger.",
    needsAttention: true,
    ...common(read, nextHourlyTriggerAt),
  };
}

function isNewerStart(read: ScannerExecutionRead): boolean {
  const startedAt = read.started?.startedAt;
  const finishedAt = read.snapshot?.latestAttempt.finishedAt;
  return Boolean(startedAt && (!finishedAt || Date.parse(startedAt) > Date.parse(finishedAt)));
}

function unresolvedFailure(read: ScannerExecutionRead): ScannerAttempt | null {
  const failure = read.snapshot?.lastFailedAttempt ?? null;
  const successAt = read.snapshot?.lastSuccessfulScanAt ?? null;
  if (!failure || (successAt && Date.parse(failure.finishedAt) <= Date.parse(successAt))) return null;
  return failure;
}

function unresolvedFailureHealth(
  read: ScannerExecutionRead,
  nextHourlyTriggerAt: string,
  failure: ScannerAttempt,
): ScannerExecutionHealth {
  const diagnosis = diagnosticDetail(failure.diagnostics[0]);
  return {
    ...common(read, nextHourlyTriggerAt),
    tone: failure.outcome === "failed" ? "danger" : "caution",
    statusLabel: "Earlier trigger failure remains unresolved",
    detail: diagnosis.detail,
    action: diagnosis.action,
    needsAttention: true,
  };
}

function completedHealth(read: ScannerExecutionRead, now: Date, nextHourlyTriggerAt: string): ScannerExecutionHealth {
  const snapshot = read.snapshot!;
  const latest = snapshot.latestAttempt;
  const facts = common(read, nextHourlyTriggerAt);
  if (latest.outcome === "failed" || latest.outcome === "partial") {
    const diagnosis = diagnosticDetail(latest.diagnostics[0]);
    return {
      ...facts,
      tone: latest.outcome === "failed" ? "danger" : "caution",
      statusLabel: latest.outcome === "failed" ? "Latest trigger failed" : "Latest trigger partial",
      detail: diagnosis.detail,
      action: diagnosis.action,
      needsAttention: true,
    };
  }
  const failure = unresolvedFailure(read);
  if (failure) return unresolvedFailureHealth(read, nextHourlyTriggerAt, failure);
  if (now.getTime() - Date.parse(latest.finishedAt) > HEARTBEAT_OVERDUE_MS) {
    return {
      ...facts,
      tone: "danger",
      statusLabel: "Scanner heartbeat overdue",
      detail: "The latest recorded trigger completion is more than 90 minutes old. This is an observed gap in execution evidence, not proof of the underlying cause.",
      action: "Check the next hourly trigger and the private runtime logs.",
      needsAttention: true,
    };
  }
  if (latest.outcome === "skipped") {
    return {
      ...facts,
      tone: "ok",
      statusLabel: "Latest trigger skipped",
      detail: latest.skipReason
        ? `The latest scheduled trigger recorded ${latest.skipReason.replaceAll("_", " ")}.`
        : "The latest scheduled trigger recorded an intentional skip.",
      action: null,
      needsAttention: false,
    };
  }
  return {
    ...facts,
    tone: "ok",
    statusLabel: "Latest trigger completed",
    detail: "The latest scheduled trigger recorded a successful scanner completion.",
    action: null,
    needsAttention: false,
  };
}

function startedHealth(read: ScannerExecutionRead, now: Date, nextHourlyTriggerAt: string): ScannerExecutionHealth {
  const startedAt = read.started!.startedAt;
  if (now.getTime() - Date.parse(startedAt) <= COMPLETION_GRACE_MS) {
    return {
      ...common(read, nextHourlyTriggerAt),
      tone: "caution",
      statusLabel: "Trigger running",
      detail: "A newer trigger start was observed, but its completion has not arrived yet. This is an observation, not proof that scan work is still running.",
      action: "Wait up to six minutes for the completion record before investigating.",
      needsAttention: false,
    };
  }
  const diagnosis = diagnosticDetail({ stage: "request", code: "completion_missing" });
  return {
    ...common(read, nextHourlyTriggerAt),
    tone: "danger",
    statusLabel: "Trigger completion missing",
    detail: `${diagnosis.detail} A newer trigger started, but no completion arrived after six minutes. This is an observed gap in trigger evidence, not proof of the underlying cause.`,
    action: diagnosis.action,
    needsAttention: true,
  };
}

export function getScannerExecutionHealth(
  read: ScannerExecutionRead,
  now: Date,
): ScannerExecutionHealth {
  const nextHourlyTriggerAt = nextHourlyScannerWake(now);
  if (read.state === "available" && isNewerStart(read)) return startedHealth(read, now, nextHourlyTriggerAt);
  if (read.state !== "available" || !read.snapshot) return unavailable(read, nextHourlyTriggerAt);

  if (read.snapshot.latestAttempt.outcome === "running") {
    const failure = unresolvedFailure(read);
    if (failure) return unresolvedFailureHealth(read, nextHourlyTriggerAt, failure);
    if (now.getTime() - Date.parse(read.snapshot.latestAttempt.finishedAt) > HEARTBEAT_OVERDUE_MS) {
      return {
        ...common(read, nextHourlyTriggerAt),
        tone: "danger",
        statusLabel: "Scanner heartbeat overdue",
        detail: "The latest saved running status is more than 90 minutes old. This is an observed gap in execution evidence, not proof of the underlying cause.",
        action: "Check the next hourly trigger and the private runtime logs.",
        needsAttention: true,
      };
    }
    return {
      ...common(read, nextHourlyTriggerAt),
      tone: "caution",
      statusLabel: "Trigger running",
      detail: "The saved trigger status reports an active scan. It is not a successful completion.",
      action: "Wait up to six minutes for a completion record before investigating.",
      needsAttention: false,
    };
  }

  return completedHealth(read, now, nextHourlyTriggerAt);
}
