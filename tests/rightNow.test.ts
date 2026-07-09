import { describe, expect, it } from "vitest";
import { EMPTY_CLUSTER_CONFIRMATIONS } from "@/lib/confirmations";
import { composeIssueReadout, type IssueReadoutInput } from "@/lib/readout";
import { buildRightNowReadout } from "@/lib/rightNow";

const basePatch = {
  version: "1.13.01",
  title: "Patch Notes Version 1.13.01 (All Platforms Hotfix)",
  officialUrl: "https://example.com/patch-11301",
  summary: "Frame-rate drops and occasional crashes were improved.",
  publishedAt: "2026-07-08T05:51:00.000Z",
};

const sourceUrl = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";
const supportUrl = "https://support.pearlabyss.com/";

function readoutFor(over: Partial<IssueReadoutInput>) {
  return composeIssueReadout({
    directReportCount: 0,
    publicSignalCount: 0,
    candidateSignalCount: 0,
    postClaimEvidenceCount: 0,
    confirmations: EMPTY_CLUSTER_CONFIRMATIONS,
    fixClaimedAt: null,
    adminOverride: false,
    storedFixStatus: "reported",
    patchVersion: basePatch.version,
    ...over,
  });
}

describe("buildRightNowReadout", () => {
  it("creates a useful readout when automation has leads but public evidence is thin", () => {
    const readout = buildRightNowReadout({
      currentPatch: basePatch,
      scanner: {
        reviewedThisWeek: 117,
        filteredThisWeek: 82,
        keptThisWeek: 35,
        awaiting: 7,
        published: 1,
        lastCheckedAt: "2026-07-08T13:00:00.000Z",
        scannerActive: true,
        scannerConnected: true,
      },
      directReports: 1,
      communitySignals: 0,
      publicFindingsCount: 0,
      latestReportAt: "2026-07-06T13:00:00.000Z",
      topClusters: [
        {
          id: "fps",
          title: "FPS / performance regression since 1.13.00",
          category: "performance",
          description: "Frame-rate drops, stutter, and frame-pacing issues after patch 1.13.00.",
          directReportCount: 1,
          signalCount: 0,
          candidateSignalCount: 0,
          postCurrentPatchEvidenceCount: 0,
          readout: readoutFor({
            directReportCount: 1,
            fixClaimedAt: "2026-07-08T06:00:00.000Z",
            storedFixStatus: "fix_claimed",
          }),
        },
        {
          id: "mount",
          title: "Mount, input, and title-screen lockups",
          category: "controls",
          description: "Horse or mount control failures, unresponsive inputs, and title-screen lockups.",
          directReportCount: 0,
          signalCount: 0,
          candidateSignalCount: 2,
          postCurrentPatchEvidenceCount: 0,
          readout: readoutFor({ candidateSignalCount: 2 }),
        },
      ],
      sourceUrl,
      supportUrl,
    });

    const observationText = readout.observations.join(" ");
    expect(observationText).toContain("1.13.01 hotfix");
    expect(observationText).toContain("Official notes");
    expect(observationText).toContain("117");
    expect(observationText).toContain("7");
    expect(observationText).toContain("1 player report");
    expect(observationText).toContain("No public source links");
    expect(readout.snapshotLine).toContain("Patch 1.13.01 hotfix");
    expect(readout.snapshotLine).toContain("1 player report");
    expect(readout.snapshotLine).toContain("no public source links cleared");
    expect(readout.snapshotLine).toContain("7 radar leads — rumors, not evidence");
    expect(readout.worthChecking.map((issue) => issue.title)).toEqual([
      "FPS / performance regression since 1.13.00",
      "Mount, input, and title-screen lockups",
    ]);
    expect(readout.worthChecking[0]).toMatchObject({
      statusLabel: "Fix claimed — unverified",
      tone: "amber",
      strengthLabel: "1 player report, 0 public sources",
      countSummary: "1 report · 0 public sources",
      actionLabel: "Add your tap",
    });
    expect(readout.worthChecking[0].detail).toContain("Quiet can mean fixed");
    expect(readout.worthChecking[1]).toMatchObject({
      statusLabel: "Radar lead",
      tone: "blue",
      strengthLabel: "2 radar leads, no public proof",
      countSummary: "0 reports · 0 public sources · 2 leads",
    });
    expect(readout.usefulLinks.map((link) => link.label)).toEqual([
      "Official patch notes",
      "Pearl Abyss support",
      "Known issues",
      "Source radar",
      "Open-source code",
    ]);
    expect(JSON.stringify(readout)).not.toContain("source_url");
    expect(JSON.stringify(readout)).not.toContain("reject");
  });

  it("stays useful when there are no reports and no scanner connection", () => {
    const readout = buildRightNowReadout({
      currentPatch: basePatch,
      scanner: {
        reviewedThisWeek: 0,
        filteredThisWeek: 0,
        keptThisWeek: 0,
        awaiting: 0,
        published: 0,
        lastCheckedAt: null,
        scannerActive: false,
        scannerConnected: false,
      },
      directReports: 0,
      communitySignals: 0,
      publicFindingsCount: 0,
      latestReportAt: null,
      topClusters: [],
      sourceUrl,
      supportUrl,
    });

    const observationText = readout.observations.join(" ");
    expect(observationText).toContain("Scanner data is unavailable");
    expect(observationText).toContain("No player reports");
    expect(readout.snapshotLine).toContain("scanner unavailable");
    expect(readout.worthChecking).toEqual([]);
    expect(readout.emptyWorthCheckingCopy).toBe(
      "No watched issue has enough signal yet. Use the official links, source radar, or add your own case.",
    );
  });

  it("does not turn private candidates into public source links", () => {
    const readout = buildRightNowReadout({
      currentPatch: basePatch,
      scanner: {
        reviewedThisWeek: 10,
        filteredThisWeek: 8,
        keptThisWeek: 2,
        awaiting: 2,
        published: 0,
        lastCheckedAt: "2026-07-08T13:00:00.000Z",
        scannerActive: true,
        scannerConnected: true,
      },
      directReports: 0,
      communitySignals: 0,
      publicFindingsCount: 0,
      latestReportAt: null,
      topClusters: [
        {
          id: "crash",
          title: "Crashes and startup hangs",
          category: "crashes",
          description: "Crashes during launch or startup.",
          directReportCount: 0,
          signalCount: 0,
          candidateSignalCount: 2,
          postCurrentPatchEvidenceCount: 0,
          readout: readoutFor({ candidateSignalCount: 2 }),
        },
      ],
      sourceUrl,
      supportUrl,
    });

    expect(readout.worthChecking[0]).toMatchObject({
      statusLabel: "Radar lead",
      countSummary: "0 reports · 0 public sources · 2 leads",
      actionLabel: "Add your tap",
    });
    expect(JSON.stringify(readout.worthChecking)).not.toContain("http");
    expect(JSON.stringify(readout.worthChecking)).not.toContain("reddit.com");
    expect(JSON.stringify(readout.worthChecking)).not.toContain("reject");
  });
});
