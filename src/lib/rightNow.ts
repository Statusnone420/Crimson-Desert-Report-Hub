import type { IssueReadout } from "@/lib/readout";

type Tone = IssueReadout["tone"];

export type RightNowClusterInput = {
  id: string;
  title: string;
  category: string;
  description: string;
  directReportCount: number;
  signalCount: number;
  candidateSignalCount: number;
  postCurrentPatchEvidenceCount: number;
  confirmationCount: number;
  readout: IssueReadout;
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
  statusLabel: string;
  evidenceNote: string;
  strengthLabel: string;
  detail: string;
  tone: Tone;
  countSummary: string;
  actionLabel: "View evidence" | "Add your tap";
};

export type RightNowReadout = {
  patchLabel: string;
  snapshotLine: string;
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
  const withTaps = issue.confirmationCount > 0 ? `${base} · ${plural(issue.confirmationCount, "player tap")}` : base;
  return issue.candidateSignalCount > 0 ? `${withTaps} · ${issue.candidateSignalCount} leads` : withTaps;
}

function issueWeight(issue: RightNowClusterInput) {
  return (
    issue.directReportCount * 5 +
    issue.signalCount * 4 +
    issue.candidateSignalCount * 2 +
    issue.confirmationCount +
    issue.postCurrentPatchEvidenceCount * 6
  );
}

function strengthLabel(issue: RightNowClusterInput): string {
  if (issue.directReportCount > 0 || issue.signalCount > 0) {
    return `${plural(issue.directReportCount, "player report")}, ${plural(issue.signalCount, "public source")}`;
  }
  if (issue.candidateSignalCount > 0) {
    return `${plural(issue.candidateSignalCount, "radar lead")}, no public proof`;
  }
  if (issue.confirmationCount > 0) {
    return `${plural(issue.confirmationCount, "player tap")}, no public proof`;
  }
  return "No player reports or public sources yet";
}

function snapshotLine(input: RightNowInput) {
  const reports =
    input.directReports > 0 ? `${plural(input.directReports, "player report")} in this patch family` : "no player reports yet";
  const publicLinks =
    input.publicFindingsCount > 0
      ? `${plural(input.publicFindingsCount, "public source link")} displayed`
      : "no public source links displayed yet";
  const radarLeads = input.scanner.scannerConnected
    ? input.scanner.awaiting > 0
      ? `${plural(input.scanner.awaiting, "radar lead")} — rumors, not evidence`
      : "no radar leads waiting"
    : "scanner unavailable";

  return [`Patch ${displayPatchVersion(input.currentPatch.version)}`, reports, publicLinks, radarLeads].join(" · ");
}

export function buildRightNowReadout(input: RightNowInput): RightNowReadout {
  const observations = [
    `Current patch: ${displayPatchVersion(input.currentPatch.version)}. Official notes are linked.`,
  ];

  if (input.scanner.scannerConnected) {
    observations.push(
      input.scanner.awaiting > 0
        ? `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; ${plural(input.scanner.awaiting, "radar lead")} ${input.scanner.awaiting === 1 ? "is" : "are"} mapped to open questions.`
        : `Scanner checked ${input.scanner.reviewedThisWeek} public candidates this week; no radar leads are waiting.`,
    );
  } else {
    observations.push("Scanner data is unavailable in this environment.");
  }

  observations.push(
    input.directReports > 0
      ? `${plural(input.directReports, "player report")} ${input.directReports === 1 ? "is" : "are"} attached to the current patch family.`
      : "No player reports are attached to the current patch family yet.",
  );

  observations.push(
    input.publicFindingsCount > 0
      ? `${plural(input.publicFindingsCount, "public source link")} ${input.publicFindingsCount === 1 ? "is" : "are"} visible as radar context for this patch.`
      : "No public source links are displayed for this patch yet.",
  );

  const worthChecking: RightNowIssue[] = input.topClusters
    .filter(
      (cluster) =>
        cluster.directReportCount > 0 ||
        cluster.signalCount > 0 ||
        cluster.candidateSignalCount > 0 ||
        cluster.confirmationCount > 0 ||
        cluster.readout.poll !== null,
    )
    .sort((a, b) => issueWeight(b) - issueWeight(a))
    .slice(0, 5)
    .map((cluster) => ({
      id: cluster.id,
      title: cluster.title,
      description: cluster.description,
      category: cluster.category,
      href: "/issues",
      statusLabel: cluster.readout.label,
      evidenceNote: cluster.readout.label,
      strengthLabel: strengthLabel(cluster),
      detail: cluster.readout.sentence,
      tone: cluster.readout.tone,
      countSummary: countSummary(cluster),
      actionLabel: cluster.readout.ask ? "Add your tap" : "View evidence",
    }));

  return {
    patchLabel: `Patch ${displayPatchVersion(input.currentPatch.version)}`,
    snapshotLine: snapshotLine(input),
    observations,
    worthChecking,
    emptyWorthCheckingCopy: "No watched issue has enough signal yet. Official notes and the source radar remain available.",
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
      "Official notes are context, not proof.",
    ],
    scannerHeartbeat: input.scanner.scannerConnected
      ? input.scanner.scannerActive
        ? "Source radar is active."
        : "Source radar is paused."
      : "Source radar is unavailable here.",
  };
}
