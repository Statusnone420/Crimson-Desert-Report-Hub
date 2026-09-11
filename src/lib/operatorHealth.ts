import type { ScannerAiHealth } from "@/lib/automation/health";
import { formatEasternDateTime, formatRelativeOperatorTime } from "@/lib/automation/runDisplay";
import { nextEligibleScheduledScanAt, type RecentRunLike } from "@/lib/automation/schedule";
import type { CollectionHealth, CollectionHealthLane } from "@/lib/collectionHealth";
import { workspaceHref } from "@/lib/operatorWorkspace";
import type { ScannerAttention } from "@/lib/scannerAttention";
import { scannerScheduleStatus } from "@/lib/scannerScheduleStatus";

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
  if (!radarAvailable) return "Unknown";
  if (screened7d <= 0) return "0 / 0";
  return `${retained7d} / ${screened7d} (${((retained7d / screened7d) * 100).toFixed(1)}%)`;
}

function laneTone(lane: CollectionHealthLane): OverviewHealthTone {
  if (lane.state === "ok" || lane.state === "disabled") return "ok";
  if (lane.state === "unknown") return "unknown";
  if (lane.state === "unavailable") return "danger";
  return "caution";
}

function scheduleStatus(input: OverviewScannerHealthInput): {
  label: string;
  tone: "green" | "amber" | "red";
} {
  if (!input.adminAvailable || !input.control || input.budgetCapped === null) {
    return { label: "UNVERIFIED", tone: "amber" };
  }
  if (input.aiHealth?.state === "unavailable" || input.aiHealth?.state === "limited") {
    return {
      label: input.aiHealth.state === "unavailable" ? "AI UNAVAILABLE" : "AI LIMITED",
      tone: "amber",
    };
  }
  return scannerScheduleStatus(input.control, input.activeRun, input.budgetCapped);
}

function lastCompletedRun(input: OverviewScannerHealthInput, nowMs: number): OverviewHealthFact {
  if (input.adminAvailable) {
    if (input.latestRealRun) {
      const completedAt = input.latestRealRun.finished_at ?? input.latestRealRun.started_at;
      return {
        id: "last-run",
        label: "Last completed run",
        value: formatRelativeOperatorTime(completedAt, nowMs),
        detail: formatEasternDateTime(completedAt),
        tone: "ok",
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
      label: "Last completed run",
      value: formatRelativeOperatorTime(input.radarHealth.lastScanAt, nowMs),
      detail: `${formatEasternDateTime(input.radarHealth.lastScanAt)}. Taken from the radar health read because the admin run record was unavailable.`,
      tone: "unknown",
    };
  }
  return {
    id: "last-run",
    label: "Last completed run",
    value: "Unknown",
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
    ).toISOString();
    return {
      id: "next-run",
      label: "Next eligible run",
      value: formatRelativeOperatorTime(nextAt, nowMs),
      detail: formatEasternDateTime(nextAt),
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
      value: formatRelativeOperatorTime(input.radarHealth.nextEligibleAt, nowMs),
      detail: `${formatEasternDateTime(input.radarHealth.nextEligibleAt)}. Taken from the radar health read because the admin run record was unavailable.`,
      tone: "unknown",
    };
  }
  return {
    id: "next-run",
    label: "Next eligible run",
    value: "Unknown",
    detail: "The schedule read did not finish.",
    tone: "unknown",
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
    schedule: [lastCompletedRun(input, nowMs), nextEligibleRun(input, nowMs)],
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
        value: input.radarAvailable ? String(screened7d) : "Unknown",
        detail: "Includes repeat screening. It is not a count of human reviews or unique issues.",
        tone: input.radarAvailable ? "ok" : "unknown",
      },
      {
        id: "awaiting",
        label: "Awaiting issue groups",
        value: input.awaiting === null ? "Unknown" : String(input.awaiting),
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
          : "Unknown",
        detail: "Only real source publication dates count; first-seen time is not a publication date.",
        tone: input.dateCoverage ? "ok" : "unknown",
      },
      {
        id: "failed-runs",
        label: "Failed runs · 7d",
        value: failedRuns === null ? "Unknown" : String(failedRuns),
        detail: "Failed scheduled or manual scans in the last seven days.",
        tone: failedRuns === null ? "unknown" : failedRuns > 0 ? "danger" : "ok",
      },
    ],
    attention: input.attention,
    diagnosticsHref: OVERVIEW_SCANNER_DIAGNOSTICS_HREF,
    collectionHref: OVERVIEW_SCANNER_COLLECTION_HREF,
  };
}
