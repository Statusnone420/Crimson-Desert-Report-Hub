import { describe, expect, it } from "vitest";
import { buildDeterministicDossier, type DossierInput } from "@/lib/dossier";

const input: DossierInput = {
  generatedAt: "2026-07-05T18:00:00Z",
  patchVersion: "1.13.00",
  totalSignals: 12,
  totalDirectReports: 40,
  totalVerifiedReports: 2,
  pendingCount: 6,
  byCategory: { performance: 25, crash_startup: 10, controls_gameplay: 5 },
  platforms: { ps5: 18, pc_steam: 15, ps5_pro: 7 },
  clusters: [
    {
      title: "Map-open crash",
      fixStatus: "persists",
      confidence: "confirmed",
      count: 8,
      signalCount: 2,
      directReportCount: 8,
      verifiedReportCount: 1,
      topPlatform: "ps5",
    },
    {
      title: "FPS regression",
      fixStatus: "reported",
      confidence: "medium",
      count: 25,
      signalCount: 10,
      directReportCount: 25,
      verifiedReportCount: 1,
      topPlatform: "pc_steam",
    },
    {
      title: "Airborne cancel",
      fixStatus: "reported",
      confidence: "seed_unverified",
      count: 0,
      signalCount: 0,
      directReportCount: 0,
      verifiedReportCount: 0,
      topPlatform: null,
    },
  ],
  communitySignals: [
    {
      title: "FPS drops since patch 1.13",
      source: "reddit",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/",
      summary: "Players report frame drops after patch 1.13.",
      category: "performance",
      clusterTitle: "FPS regression",
    },
  ],
  reproNotes: [{ title: "Map-open crash", steps: "Open world map during mounted combat" }],
  directReportEvidenceUrls: ["https://www.reddit.com/r/CrimsonDesert/comments/direct-report/"],
  verifiedReports: [
    { reportId: "report-map", title: "Map-open crash", excerpt: "Map still crashes during mounted combat.", platform: "ps5" },
    {
      reportId: "report-fps",
      title: "FPS regression",
      excerpt: "Steam frame pacing dropped after patch 1.13.",
      platform: "pc_steam",
    },
  ],
};

describe("buildDeterministicDossier", () => {
  const md = buildDeterministicDossier(input);

  it("contains all seven required sections", () => {
    for (const h of [
      "## Executive summary",
      "## Top issues",
      "## Community signal summary",
      "## Direct reports",
      "## Platform and hardware breakdown",
      "## Reproduction patterns",
      "## Evidence links",
      "## Verified reports",
      "## Known confidence gaps",
      "## Recommended wording for Pearl Abyss",
    ]) {
      expect(md).toContain(h);
    }
  });

  it("ranks issues by count descending", () => {
    expect(md.indexOf("FPS regression")).toBeLessThan(md.indexOf("Map-open crash"));
  });

  it("flags persists-after-fix issues and excludes zero-count unverified from top issues", () => {
    expect(md).toContain("persists after a claimed fix");
    const topSection = md.split("## Top issues")[1].split("## Platform")[0];
    expect(topSection).not.toContain("Airborne cancel");
  });

  it("lists unverified clusters in confidence gaps", () => {
    const gaps = md.split("## Known confidence gaps")[1];
    expect(gaps).toContain("Airborne cancel");
  });

  it("includes headline numbers", () => {
    expect(md).toContain("12 automated community signals");
    expect(md).toContain("40 approved direct reports");
    expect(md).toContain("2 verified reports");
    expect(md).toContain("1.13.00");
  });

  it("separates community signals, direct reports, and verified reports", () => {
    expect(md).toContain("Community signals");
    expect(md).toContain("Direct reports");
    expect(md).toContain("Verified reports");
    expect(md).toContain("Direct report evidence links only");
    expect(md).toContain("Map still crashes during mounted combat.");
  });
});
