import type { ScannerAiHealth } from "@/lib/automation/health";
import { formatEasternDateTime, formatRelativeOperatorTime } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt, type RecentRunLike } from "@/lib/automation/schedule";
import type { CollectionHealth, CollectionHealthLane } from "@/lib/collectionHealth";
import { workspaceHref } from "@/lib/operatorWorkspace";
import type { ScannerAttention } from "@/lib/scannerAttention";
import { scannerScheduleStatus } from "@/lib/scannerScheduleStatus";
import type { ScannerExecutionHealth } from "@/lib/automation/executionHealth";

export const OVERVIEW_SCANNER_DIAGNOSTICS_HREF = `${workspaceHref("scanner")}#health`;
export const OVERVIEW_SCANNER_COLLECTION_HREF = `${workspaceHref("scanner", { section: "collection" })}#collection-health`;

export type OverviewHealthTone = "ok" | "caution" | "danger" | "unknown";

export type OverviewHealthFact = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: OverviewHealthTone;
};

export type OverviewScannerHealthModel = {
  headline: string;
  statusLabel: string;
  statusTone: "green" | "amber" | "red";
  schedule: OverviewHealthFact[];
  providers: OverviewHealthFact[];
  counters: OverviewHealthFact[];
  attention: ScannerAttention;
  diagnosticsHref: string;
  collectionHref: string;
};

export type OverviewScannerHealthInput = {
  now: Date;
  adminAvailable: boolean;
  radarAvailable: boolean;
  control: { paused: boolean; minIntervalMinutes: number } | null;
  activeRun: { id: string } | null;
  runs: RecentRunLike[];
  budgetCapped: boolean | null;
  latestRealRun: RecentRunLike & { started_at: string; finished_at: string | null } | null;
  latestCompletedRun: RecentRunLike & { started_at: string; finished_at: string | null } | null;
  radarHealth: {
    lastScanAt: string | null;
    nextEligibleAt: string | null;
    paused: boolean;
    runs7d: { failed: number };
  } | null;
  funnel7d: { reviewed: number; kept: number } | null;
  dateCoverage: { withSourceDate: number; tracked: number } | null;
  awaiting: number | null;
  collection: CollectionHealth;
  attention: ScannerAttention;
  aiHealth?: ScannerAiHealth;
  execution?: ScannerExecutionHealth;
};

export type PolicyAiStatus = {
  label: string;
  tone: "green" | "amber" | "red";
};

export function overviewHealthHeadline(attention: ScannerAttention): string {
  if (attention.count === null) return "A required health read is unavailable.";
  if (attention.count === 0) return "No named health checks require action.";
  return `${attention.count} named health ${attention.count === 1 ? "check needs" : "checks need"} attention.`;
}

export function retainedLeadShareLabel(
  radarAvailable: boolean,
  screened7d: number,
  retained7d: number,
): string {
  if (!radarAvailable) return "Radar read unavailable";
  if (screened7d <= 0) return "0 / 0";
  return `${retained7d} / ${screened7d} (${((retained7d / screened7d) * 100).toFixed(1)}%)`;
}

function laneTone(lane: CollectionHealthLane): OverviewHealthTone {
  if (lane.state === "ok" || lane.state === "disabled") return "ok";
  if (lane.state === "unknown") return "unknown";
  if (lane.state === "unavailable") return "danger";
  return "caution";
}

export function policyAiStatus(input: Pick<OverviewScannerHealthInput,
  "adminAvailable" | "control" | "activeRun" | "budgetCapped" | "aiHealth"
>): PolicyAiStatus {
  if (!input.adminAvailable || !input.control || input.budgetCapped === null) {
    return { label: "UNVERIFIED", tone: "amber" };
  }
  if (input.aiHealth?.state === "unavailable" || input.aiHealth?.state === "limited") {
    return {
      label: input.aiHealth.state === "unavailable" ? "AI UNAVAILABLE" : "AI LIMITED",
      tone: "amber",
    };
  }
  const schedule = scannerScheduleStatus(input.control, input.activeRun, input.budgetCapped);
  return { label: schedule.label, tone: schedule.tone };
}

function scheduleStatus(input: OverviewScannerHealthInput): PolicyAiStatus {
  if (input.execution && input.execution.tone !== "ok") {
    return {
      label: input.execution.statusLabel.toUpperCase(),
      tone: input.execution.tone === "danger" || input.execution.tone === "unavailable" ? "red" : "amber",
    };
  }
  return policyAiStatus(input);
}

function lastCompletedRun(input: OverviewScannerHealthInput, nowMs: number): OverviewHealthFact {
  if (input.adminAvailable) {
    if (input.latestCompletedRun) {
      const completedAt = input.latestCompletedRun.finished_at ?? input.latestCompletedRun.started_at;
      return {
        id: "last-run",
        label: "Last completed run",
        value: formatRelativeOperatorTime(completedAt, nowMs),
        detail: formatEasternDateTime(completedAt),
        tone: input.latestCompletedRun.status === "failed"
          ? "danger"
          : input.latestCompletedRun.status === "partial"
            ? "caution"
            : "ok",
      };
    }
    return {
      id: "last-run",
      label: "Last completed run",
      value: "None recorded",
      detail: "The completed-run read succeeded and found no success, partial, or failed scan.",
      tone: "ok",
    };
  }
  if (input.radarAvailable && input.radarHealth?.lastScanAt) {
    return {
      id: "last-run",
      label: "Last scan recorded",
      value: formatRelativeOperatorTime(input.radarHealth.lastScanAt, nowMs),
      detail: `${formatEasternDateTime(input.radarHealth.lastScanAt)}. Taken from the radar health read because the admin run record was unavailable.`,
      tone: "unknown",
    };
  }
  return {
    id: "last-run",
    label: "Last completed run",
    value: "Run history unavailable",
    detail: "The completed-run read did not finish.",
    tone: "unknown",
  };
}

function nextEligibleRun(input: OverviewScannerHealthInput, nowMs: number): OverviewHealthFact {
  if (input.adminAvailable && input.control) {
    if (input.control.paused) {
      return {
        id: "next-run",
        label: "Next eligible run",
        value: "Paused",
        detail: "Scheduled scans are paused.",
        tone: "caution",
      };
    }
    // Hourly skip rows can push the last real scan outside the ten-row history.
    const nextAt = nextEligibleScheduledScanAt(
      input.latestRealRun ? [...input.runs, input.latestRealRun] : input.runs,
      input.now,
      input.control.minIntervalMinutes,
    );
    const nextAtIso = nextAt instanceof Date ? nextAt.toISOString() : String(nextAt);
    return {
      id: "next-run",
      label: "Next eligible run",
      value: Date.parse(nextAtIso) <= nowMs ? "Eligible now" : formatRelativeOperatorTime(nextAtIso, nowMs),
      detail: formatEasternDateTime(nextAtIso),
      tone: "ok",
    };
  }
  if (input.radarAvailable && input.radarHealth) {
    if (input.radarHealth.paused || !input.radarHealth.nextEligibleAt) {
      return {
        id: "next-run",
        label: "Next eligible run",
        value: "Paused",
        detail: "The radar health read reports scheduled scans as paused.",
        tone: "caution",
      };
    }
    return {
      id: "next-run",
      label: "Next eligible run",
      value: Date.parse(input.radarHealth.nextEligibleAt) <= nowMs
        ? "Eligible now"
        : formatRelativeOperatorTime(input.radarHealth.nextEligibleAt, nowMs),
      detail: `${formatEasternDateTime(input.radarHealth.nextEligibleAt)}. Taken from the radar health read because the admin run record was unavailable.`,
      tone: "unknown",
    };
  }
  return {
    id: "next-run",
    label: "Next eligible run",
    value: "Schedule record unavailable",
    detail: "The schedule read did not finish.",
    tone: "unknown",
  };
}

function executionFact(input: OverviewScannerHealthInput): OverviewHealthFact | null {
  if (!input.execution) return null;
  return {
    id: "execution",
    label: "Latest execution evidence",
    value: input.execution.statusLabel,
    detail: input.execution.action ? `${input.execution.detail} ${input.execution.action}` : input.execution.detail,
    tone: input.execution.tone === "ok" ? "ok" : input.execution.tone === "danger" ? "danger" : "unknown",
  };
}

function policyAiFact(input: OverviewScannerHealthInput): OverviewHealthFact {
  const status = policyAiStatus(input);
  return {
    id: "policy-ai",
    label: "Policy and AI state",
    value: status.label,
    detail: "Current scanner policy and AI health, separate from scheduled execution evidence.",
    tone: status.tone === "green" ? "ok" : status.tone === "red" ? "danger" : "caution",
  };
}

export function buildOverviewScannerHealth(
  input: OverviewScannerHealthInput,
): OverviewScannerHealthModel {
  const nowMs = input.now.getTime();
  const status = scheduleStatus(input);
  const screened7d = input.funnel7d?.reviewed ?? 0;
  const retained7d = input.funnel7d?.kept ?? 0;
  const failedRuns = input.radarAvailable ? input.radarHealth?.runs7d.failed ?? null : null;

  return {
    headline: overviewHealthHeadline(input.attention),
    statusLabel: status.label,
    statusTone: status.tone,
    schedule: [lastCompletedRun(input, nowMs), nextEligibleRun(input, nowMs), executionFact(input), policyAiFact(input)].filter(
      (fact): fact is OverviewHealthFact => fact !== null,
    ),
    providers: input.collection.lanes.map((lane) => ({
      id: `provider-${lane.key}`,
      label: lane.label,
      value: lane.labelText,
      detail: lane.nextAction ?? lane.detail,
      tone: laneTone(lane),
    })),
    counters: [
      {
        id: "screened-7d",
        label: "Automated screening events · 7d",
        value: input.radarAvailable ? String(screened7d) : "Radar read unavailable",
        detail: "Includes repeat screening. It is not a count of human reviews or unique issues.",
        tone: input.radarAvailable ? "ok" : "unknown",
      },
      {
        id: "awaiting",
        label: "Awaiting issue groups",
        value: input.awaiting === null ? "Awaiting count unavailable" : String(input.awaiting),
        detail: "Current-patch private leads without corroboration. This is background inventory, not a task queue.",
        tone: input.awaiting === null ? "unknown" : "ok",
      },
      {
        id: "retained-share",
        label: "Retained-lead share · 7d",
        value: retainedLeadShareLabel(input.radarAvailable, screened7d, retained7d),
        detail: "Retained leads divided by automated screening events. This is not an accuracy measure.",
        tone: input.radarAvailable ? "ok" : "unknown",
      },
      {
        id: "date-coverage",
        label: "Leads with source dates",
        value: input.dateCoverage
          ? `${input.dateCoverage.withSourceDate} / ${input.dateCoverage.tracked}`
          : "Source-date read unavailable",
        detail: "Only real source publication dates count; first-seen time is not a publication date.",
        tone: input.dateCoverage ? "ok" : "unknown",
      },
      {
        id: "failed-runs",
        label: "Recorded failed runs · 7d",
        value: failedRuns === null ? "Recorded-run read unavailable" : String(failedRuns),
        detail: "Counts failed scheduled or manual Supabase run records. Pre-ledger trigger failures are not included.",
        tone: failedRuns === null ? "unknown" : failedRuns > 0 ? "danger" : "ok",
      },
    ],
    attention: input.attention,
    diagnosticsHref: OVERVIEW_SCANNER_DIAGNOSTICS_HREF,
    collectionHref: OVERVIEW_SCANNER_COLLECTION_HREF,
  };
}
