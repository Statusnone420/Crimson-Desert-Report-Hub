import { describe, expect, it, vi } from "vitest";
import { countDistinctVerifiedReportsByCluster, publicFindingsFromSignals } from "@/lib/queries";

vi.mock("server-only", () => ({}));

describe("countDistinctVerifiedReportsByCluster", () => {
  it("counts one verified report per report id", () => {
    const counts = countDistinctVerifiedReportsByCluster([
      { report_id: "report-a", bug_reports: { cluster_id: "cluster-one" } },
      { report_id: "report-a", bug_reports: { cluster_id: "cluster-one" } },
      { report_id: "report-b", bug_reports: { cluster_id: "cluster-one" } },
      { report_id: "report-c", bug_reports: { cluster_id: "cluster-two" } },
      { report_id: "report-d", bug_reports: null },
    ]);

    expect(counts).toEqual({
      "cluster-one": 2,
      "cluster-two": 1,
    });
  });
});

describe("publicFindingsFromSignals", () => {
  it("maps already-public signal links without exposing private review fields", () => {
    const findings = publicFindingsFromSignals([
      {
        id: "signal-1",
        cluster_id: "cluster-fps",
        source: "web_search",
        source_url: "https://www.reddit.com/r/CrimsonDesert/comments/example/",
        title: "FPS drops after patch 1.13",
        summary: "Players mention frame-rate drops after the patch.",
        category: "performance",
        confidence: "high",
        observed_at: "2026-07-08T12:00:00.000Z",
        source_published_at: "2026-07-08T11:30:00.000Z",
        public_status: "public",
      },
    ]);

    expect(findings).toEqual([
      {
        id: "signal-1",
        title: "FPS drops after patch 1.13",
        summary: "Players mention frame-rate drops after the patch.",
        source: "web_search",
        sourceUrl: "https://www.reddit.com/r/CrimsonDesert/comments/example/",
        sourceHost: "reddit.com",
        confidence: "high",
        observedAt: "2026-07-08T12:00:00.000Z",
        clusterId: "cluster-fps",
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain("raw_text");
    expect(JSON.stringify(findings)).not.toContain("reject");
    expect(JSON.stringify(findings)).not.toContain("private");
  });
});
