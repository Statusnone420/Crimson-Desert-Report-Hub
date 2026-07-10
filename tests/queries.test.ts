import { describe, expect, it, vi } from "vitest";
import {
  countPostCurrentPatchReportsByCluster,
  countCurrentPatchCandidateSignalsByCluster,
  countRowsAtOrAfterClaimByCluster,
  countDistinctVerifiedReportsByCluster,
  excerptsByClusterForCurrentPatch,
  filterExactPatchReports,
  filterPatchFamilyReports,
  groupConfirmationRowsByCluster,
  latestReportAtFromRows,
  publicFindingsFromSignals,
  readConfirmationRowsByClusterForPatchFamily,
  readExcerptsByClusterForCurrentPatch,
  reportPlatformCountsByCluster,
} from "@/lib/queries";

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

describe("filterPatchFamilyReports", () => {
  it("keeps approved reports in the current patch family only", () => {
    const rows = filterPatchFamilyReports(
      [
        { cluster_id: "old-major", patch_version: "1.12.00" },
        { cluster_id: "family-base", patch_version: "1.13.00" },
        { cluster_id: "family-hotfix", patch_version: "1.13.01" },
        { cluster_id: "missing", patch_version: null },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
    );

    expect(rows.map((row) => row.cluster_id)).toEqual(["family-base", "family-hotfix"]);
  });
});

describe("latestReportAtFromRows", () => {
  it("uses the newest report after patch-family filtering", () => {
    const rows = filterPatchFamilyReports(
      [
        { cluster_id: "old-major", patch_version: "1.12.00", created_at: "2026-07-08T13:00:00.000Z" },
        { cluster_id: "family-base", patch_version: "1.13.00", created_at: "2026-07-08T11:00:00.000Z" },
        { cluster_id: "family-hotfix", patch_version: "1.13.01", created_at: "2026-07-08T12:00:00.000Z" },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
    );

    expect(latestReportAtFromRows(rows)).toBe("2026-07-08T12:00:00.000Z");
  });
});

describe("countPostCurrentPatchReportsByCluster", () => {
  it("requires the report's selected patch to match the current hotfix", () => {
    const counts = countPostCurrentPatchReportsByCluster(
      [
        {
          cluster_id: "pre-hotfix-report",
          category: "performance",
          platform: "PC (Steam)",
          patch_version: "1.13.00",
          created_at: "2026-07-08T12:00:00.000Z",
        },
        {
          cluster_id: "current-hotfix-report",
          category: "performance",
          platform: "PC (Steam)",
          patch_version: "1.13.01",
          created_at: "2026-07-08T12:00:00.000Z",
        },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
    );

    expect(counts).toEqual({ "current-hotfix-report": 1 });
  });
});

describe("filterExactPatchReports", () => {
  it("does not use an older family report to dispute a newer hotfix claim", () => {
    const rows = [
      { id: "older", patch_version: "1.13.00" },
      { id: "current", patch_version: "1.13.01" },
      { id: "unknown", patch_version: null },
    ];
    expect(filterExactPatchReports(rows, "1.13.01").map((row) => row.id)).toEqual(["current"]);
  });

  it("counts equivalent version spellings as the exact current patch", () => {
    const rows = [
      { id: "no-leading-zero", patch_version: "1.13.1" },
      { id: "exact", patch_version: "1.13.01" },
      { id: "older", patch_version: "1.13.00" },
    ];
    expect(filterExactPatchReports(rows, "1.13.01").map((row) => row.id)).toEqual(["no-leading-zero", "exact"]);
  });
});

describe("countRowsAtOrAfterClaimByCluster", () => {
  it("counts only evidence timestamped at or after each cluster's fix claim", () => {
    const counts = countRowsAtOrAfterClaimByCluster(
      [
        { cluster_id: "claimed", happened_at: "2026-07-08T09:59:59Z" },
        { cluster_id: "claimed", happened_at: "2026-07-08T10:00:00Z" },
        { cluster_id: "claimed", happened_at: "2026-07-08T11:00:00Z" },
        { cluster_id: "unclaimed", happened_at: "2026-07-08T11:00:00Z" },
        { cluster_id: "claimed", happened_at: null },
      ],
      { claimed: "2026-07-08T10:00:00Z", unclaimed: null },
      (row) => row.happened_at,
    );

    expect(counts).toEqual({ claimed: 2 });
  });
});

describe("countCurrentPatchCandidateSignalsByCluster", () => {
  it("keeps private questions current-patch scoped without returning their text", () => {
    const counts = countCurrentPatchCandidateSignalsByCluster(
      [
        {
          cluster_id: "current",
          title: "Possible input issue after 1.13.01",
          summary: "A recent player mention.",
          source_url: "https://forum.example.com/current",
          source_published_at: "2026-07-09T00:00:00Z",
        },
        {
          cluster_id: "old",
          title: "Input issue in 1.12.00",
          summary: "An older patch mention.",
          source_url: "https://forum.example.com/old",
          source_published_at: "2026-06-01T00:00:00Z",
        },
        {
          cluster_id: "unsupported",
          title: "Crackwatch repack thread",
          summary: "Pirated files, not a player issue report.",
          source_url: "https://example.com/repack-1-13-01",
          source_published_at: "2026-07-09T00:00:00Z",
        },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00Z" },
    );

    expect(counts).toEqual({ current: 1 });
  });
});

describe("excerptsByClusterForCurrentPatch", () => {
  it("filters stale excerpts before applying the public excerpt cap", () => {
    const staleRows = Array.from({ length: 120 }, (_, index) => ({
      excerpt_text: `old excerpt ${index}`,
      created_at: "2026-07-08T13:00:00.000Z",
      bug_reports: { cluster_id: "old-cluster", platform: "PC (Steam)", patch_version: "1.12.00" },
    }));
    const grouped = excerptsByClusterForCurrentPatch(
      [
        ...staleRows,
        {
          excerpt_text: "current patch excerpt",
          created_at: "2026-07-08T12:00:00.000Z",
          bug_reports: { cluster_id: "current-cluster", platform: "Base PS5", patch_version: "1.13.01" },
        },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
      100,
    );

    expect(grouped["old-cluster"]).toBeUndefined();
    expect(grouped["current-cluster"]).toEqual([{ text: "current patch excerpt", platform: "Base PS5" }]);
  });
});

describe("readExcerptsByClusterForCurrentPatch", () => {
  it("paginates approved excerpts before filtering by patch", async () => {
    const staleRows = Array.from({ length: 1000 }, (_, index) => ({
      excerpt_text: `old excerpt ${index}`,
      created_at: "2026-07-08T13:00:00.000Z",
      bug_reports: { cluster_id: "old-cluster", platform: "PC (Steam)", patch_version: "1.12.00" },
    }));
    const rangeCalls: [number, number][] = [];
    const pages = [
      staleRows,
      [
        {
          excerpt_text: "current patch excerpt",
          created_at: "2026-07-08T12:00:00.000Z",
          bug_reports: { cluster_id: "current-cluster", platform: "Base PS5", patch_version: "1.13.01" },
        },
      ],
    ];
    const supabase = {
      from(table: string) {
        expect(table).toBe("approved_excerpts");
        return {
          select() {
            return {
              order() {
                return {
                  async range(from: number, to: number) {
                    rangeCalls.push([from, to]);
                    return { data: pages.shift() ?? [], error: null };
                  },
                };
              },
            };
          },
        };
      },
    };

    const grouped = await readExcerptsByClusterForCurrentPatch(
      supabase as never,
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
      100,
    );

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(grouped["old-cluster"]).toBeUndefined();
    expect(grouped["current-cluster"]).toEqual([{ text: "current patch excerpt", platform: "Base PS5" }]);
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

describe("groupConfirmationRowsByCluster", () => {
  it("groups raw confirmation rows per cluster without losing any", () => {
    const grouped = groupConfirmationRowsByCluster([
      { cluster_id: "cluster-one", platform: "pc_steam", kind: "have_it", voter_ip_hash: "h1", created_at: "2026-07-09T10:00:00Z" },
      { cluster_id: "cluster-one", platform: "ps5", kind: "still_happening", voter_ip_hash: "h2", created_at: "2026-07-09T11:00:00Z" },
      { cluster_id: "cluster-two", platform: "ps5", kind: "fixed_for_me", voter_ip_hash: "h3", created_at: "2026-07-09T12:00:00Z" },
    ]);

    expect(Object.keys(grouped).sort()).toEqual(["cluster-one", "cluster-two"]);
    expect(grouped["cluster-one"]).toHaveLength(2);
    expect(grouped["cluster-two"][0].kind).toBe("fixed_for_me");
  });
});

describe("readConfirmationRowsByClusterForPatchFamily", () => {
  it("paginates past the Data API row cap before aggregating confirmations", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `confirm-${index}`,
      cluster_id: "cluster-one",
      platform: "pc_steam",
      kind: "have_it" as const,
      voter_ip_hash: `hash-${index}`,
      created_at: "2026-07-09T10:00:00Z",
    }));
    const secondPage = [
      {
        id: "confirm-1000",
        cluster_id: "cluster-two",
        platform: "ps5",
        kind: "fixed_for_me" as const,
        voter_ip_hash: "hash-1000",
        created_at: "2026-07-09T11:00:00Z",
      },
    ];
    const rangeCalls: [number, number][] = [];
    const pages = [firstPage, secondPage];
    const supabase = {
      from(table: string) {
        expect(table).toBe("issue_confirmations");
        return {
          select() {
            return {
              eq(column: string, value: string) {
                expect([column, value]).toEqual(["patch_family", "1.13"]);
                return {
                  order(columnName: string) {
                    expect(columnName).toBe("id");
                    return {
                      async range(from: number, to: number) {
                        rangeCalls.push([from, to]);
                        return { data: pages.shift() ?? [], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const grouped = await readConfirmationRowsByClusterForPatchFamily(supabase as never, "1.13.01");

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(grouped["cluster-one"]).toHaveLength(1000);
    expect(grouped["cluster-two"]).toHaveLength(1);
  });
});

describe("reportPlatformCountsByCluster", () => {
  it("counts approved reports per cluster per platform", () => {
    const counts = reportPlatformCountsByCluster([
      { cluster_id: "cluster-one", platform: "pc_steam" },
      { cluster_id: "cluster-one", platform: "pc_steam" },
      { cluster_id: "cluster-one", platform: "ps5" },
      { cluster_id: "cluster-two", platform: null },
      { cluster_id: null, platform: "ps5" },
    ]);

    expect(counts["cluster-one"]).toEqual({ pc_steam: 2, ps5: 1 });
    expect(counts["cluster-two"]).toBeUndefined();
  });
});
