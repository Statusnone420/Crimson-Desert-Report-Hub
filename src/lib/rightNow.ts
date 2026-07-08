import { playerIssueStatus, type PlayerIssueStatus } from "@/lib/patchWatch";

type Tone = PlayerIssueStatus["tone"];

export type RightNowClusterInput = {
  id: string;
  title: string;
  category: string;
  description: string;
  fix_status: string;
  directReportCount: number;
  signalCount: number;
  candidateSignalCount: number;
  postCurrentPatchEvidenceCount: number;
};

export type RightNowScannerInput = {
  reviewedThisWeek: number;
  filteredThisWeek: number;
  keptThisWeek: number;
  awaiting: number;
  published: number;
  lastCheckedAt: string | null;
  scannerActive: boolean;
  scannerConnected: boolean;
};

export type RightNowInput = {
  currentPatch: {
    version: string;
    title: string;
    officialUrl: string;
    summary: string | null;
    publishedAt: string | null;
  };
  scanner: RightNowScannerInput;
  directReports: number;
  communitySignals: number;
  publicFindingsCount: number;
  latestReportAt: string | null;
  topClusters: RightNowClusterInput[];
  sourceUrl: string;
  supportUrl: string;
};

export type RightNowIssue = {
  id: string;
  title: string;
  description: string;
  category: string;
  href: string;
  statusLabel: PlayerIssueStatus["label"];
  evidenceNote: string;
  strengthLabel: string;
  detail: string;
  tone: Tone;
  countSummary: string;
  actionLabel: "View evidence" | "I am seeing this";
};

export type RightNowReadout = {
  patchLabel: string;
  observations: string[];
  worthChecking: RightNowIssue[];
  emptyWorthCheckingCopy: string;
  usefulLinks: { label: string; href: string; external?: boolean }[];
  trustNotes: string[];
  scannerHeartbeat: string;
};

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function displayPatchVersion(version: string) {
  return version.endsWith(".01") ? `${version} hotfix` : version;
}

function countSummary(issue: RightNowClusterInput) {
  const base = `${issue.directReportCount} ${issue.directReportCount === 1 ? "report" : "reports"} · ${issue.signalCount} public sources`;
  return issue.candidateSignalCount > 0 ? `${base} · ${issue.candidateSignalCount} leads` : base;
}

function issueWeight(issue: RightNowClusterInput) {
  return (
    issue.directReportCount * 5 +
    issue.signalCount * 4 +
    issue.candidateSignalCount * 2 +
    issue.postCurrentPatchEvidenceCount * 6
  );
}

function evidenceNote(issue: RightNowClusterInput) {
  if (issue.fix_status === "fix_claimed" && issue.postCurrentPatchEvidenceCount > 0) {
    return "Still happening after hotfix";
  }
  if (issue.directReportCount === 1 && issue.signalCount === 0) {
    return "Early evidence";
  }
  if (issue.directReportCount > 0 || issue.signalCount > 0) {
    return "Backed signal";
  }
  if (issue.candidateSignalCount > 0) {
    return "Needs another source";
  }
  return "Watching";
}

export function buildRightNowReadout(input: RightNowInput): RightNowReadout {
  const observations = [
    `Current patch: ${displayPatchVersion(input.currentPatch.version)}. Official notes are linked.`,
  ];

  if (input.scanner.scannerConnected) {
    observations.push(
      input.scanner.awaiting > 0
        ? `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; ${input.scanner.awaiting} still need another source before publishing.`
        : `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; nothing is waiting for corroboration.`,
    );
  } else {
    observations.push("Scanner data is not connected in this environment.");
  }

  observations.push(
    input.directReports > 0
      ? `${plural(input.directReports, "player report")} is attached to the current patch family.`
      : "No player reports are attached to the current patch family yet.",
  );

  observations.push(
    input.publicFindingsCount > 0
      ? `${plural(input.publicFindingsCount, "public source link")} cleared the evidence rules for this patch.`
      : "No public source links are strong enough yet for this patch.",
  );

  const worthChecking = input.topClusters
    .filter((cluster) => cluster.directReportCount > 0 || cluster.signalCount > 0 || cluster.candidateSignalCount > 0)
    .sort((a, b) => issueWeight(b) - issueWeight(a))
    .slice(0, 5)
    .map((cluster) => {
      const status = playerIssueStatus({
        directReportCount: cluster.directReportCount,
        publicSignalCount: cluster.signalCount,
        candidateSignalCount: cluster.candidateSignalCount,
        postCurrentPatchEvidenceCount: cluster.postCurrentPatchEvidenceCount,
        fixStatus: cluster.fix_status,
      });

      return {
        id: cluster.id,
        title: cluster.title,
        description: cluster.description,
        category: cluster.category,
        href: "/issues",
        statusLabel: status.label,
        evidenceNote: evidenceNote(cluster),
        strengthLabel: status.strengthLabel,
        detail: status.detail,
        tone: status.tone,
        countSummary: countSummary(cluster),
        actionLabel: cluster.directReportCount > 0 || cluster.signalCount > 0 ? "View evidence" : "I am seeing this",
      };
    });

  return {
    patchLabel: `Patch ${displayPatchVersion(input.currentPatch.version)}`,
    observations,
    worthChecking,
    emptyWorthCheckingCopy: "No watched issue has enough signal yet. Use the official links, source radar, or add your own case.",
    usefulLinks: [
      { label: "Official patch notes", href: input.currentPatch.officialUrl, external: true },
      { label: "Pearl Abyss support", href: input.supportUrl, external: true },
      { label: "Known issues", href: "/issues" },
      { label: "Source radar", href: "/scanner" },
      { label: "Open-source code", href: input.sourceUrl, external: true },
    ],
    trustNotes: [
      "No accounts, ads, or trackers.",
      "Raw reports stay private; public pages use neutral summaries and counts.",
      "Scanner candidates stay private until corroborated.",
      "Official notes provide context, not player evidence.",
    ],
    scannerHeartbeat: input.scanner.scannerConnected
      ? input.scanner.scannerActive
        ? "Source radar is active."
        : "Source radar is paused."
      : "Source radar is not connected here.",
  };
}
