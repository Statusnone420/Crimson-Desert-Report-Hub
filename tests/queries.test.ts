import { describe, expect, it, vi } from "vitest";
import {
  countPostCurrentPatchReportsByCluster,
  countCurrentPatchCandidateSignalsByCluster,
  countRowsAtOrAfterClaimByCluster,
  countDistinctVerifiedReportsByCluster,
  excerptsByClusterForCurrentPatch,
  getPublicObservations,
  getCandidateSignalCountsByCluster,
  isPublicObservationEligible,
  filterExactPatchReports,
  filterPublicCurrentPatchSignals,
  filterPatchFamilyReports,
  groupConfirmationRowsByCluster,
  latestReportAtFromRows,
  publicFindingsFromSignals,
  readConfirmationRowsByClusterForPatchFamily,
  readExcerptsByClusterForCurrentPatch,
  reportPlatformCountsByCluster,
} from "@/lib/queries";

vi.mock("server-only", () => ({}));

type ObservationQueryRow = {
  id: string;
  patch_version: string;
  kind: string;
  is_public: boolean;
  title: string;
  url: string;
  source_domain: string | null;
  snippet: string | null;
  observed_at: string;
  seen_count: number;
};

function observationClient(rows: ObservationQueryRow[], error: { message: string } | null = null) {
  return {
    from(table: string) {
      expect(table).toBe("patch_observations");
      const filters: ((row: ObservationQueryRow) => boolean)[] = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: string | boolean) {
          filters.push((row) => row[column as keyof ObservationQueryRow] === value);
          return query;
        },
        in(column: string, values: string[]) {
          filters.push((row) => values.includes(String(row[column as keyof ObservationQueryRow])));
          return query;
        },
        order() {
          return query;
        },
        limit(count: number) {
          return Promise.resolve({ data: error ? null : rows.filter((row) => filters.every((filter) => filter(row))).slice(0, count), error });
        },
      };
      return query;
    },
  };
}

describe("getPublicObservations", () => {
  it("keeps separate eight-row budgets for coverage and community asks", async () => {
    const rows: ObservationQueryRow[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `coverage-${index}`,
        patch_version: "1.13.01",
        kind: "press_reception",
        is_public: true,
        title: `Crimson Desert coverage ${index}`,
        url: `https://example.com/crimson-desert-coverage-${index}`,
        source_domain: "example.com",
        snippet: "Coverage",
        observed_at: `2026-07-16T12:${String(index).padStart(2, "0")}:00Z`,
        seen_count: 1,
      })),
      {
        id: "ask-current",
        patch_version: "1.13.01",
        kind: "community_ask",
        is_public: true,
        title: "Current-patch Crimson Desert community ask",
        url: "https://reddit.com/r/CrimsonDesert/current-ask",
        source_domain: "reddit.com",
        snippet: "Ask",
        observed_at: "2026-07-16T13:00:00Z",
        seen_count: 2,
      },
      {
        id: "ask-old-patch",
        patch_version: "1.13.00",
        kind: "community_ask",
        is_public: true,
        title: "Old-patch Crimson Desert community ask",
        url: "https://reddit.com/r/CrimsonDesert/old-ask",
        source_domain: "reddit.com",
        snippet: "Old ask",
        observed_at: "2026-07-16T14:00:00Z",
        seen_count: 9,
      },
    ];

    const observations = await getPublicObservations(observationClient(rows) as never, "1.13.01");

    expect(observations.filter((observation) => observation.kind === "press_reception")).toHaveLength(8);
    expect(observations.filter((observation) => observation.kind === "community_ask")).toEqual([
      expect.objectContaining({ id: "ask-current", title: "Current-patch Crimson Desert community ask" }),
    ]);
    expect(observations.map((observation) => observation.id)).not.toContain("ask-old-patch");
  });

  it("revalidates legacy public rows without deleting production data", () => {
    const shared = {
      id: "observation",
      patch_version: "1.14.00",
      kind: "patch_release" as const,
      is_public: true,
      source_domain: "reddit.com",
      observed_at: "2026-07-22T12:00:00Z",
      seen_count: 1,
    };

    expect(isPublicObservationEligible({
      ...shared,
      title: "Any plans for MCP? : r/ProtonMail",
      url: "https://www.reddit.com/r/ProtonMail/comments/example/mcp/",
      snippet: "A Proton Lumo feature request.",
    }, "1.14.00")).toBe(false);
    expect(isPublicObservationEligible({
      ...shared,
      title: "[Updates] Patch Notes Version 1.03.01 (All Platforms Hotfix)",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/example/old_patch/",
      snippet: "Crimson Desert update notes.",
    }, "1.14.00")).toBe(false);
    expect(isPublicObservationEligible({
      ...shared,
      title: "Crimson Desert Version 1.14.00 patch notes",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/example/current_patch/",
      snippet: "Current Crimson Desert update notes.",
    }, "1.14.00")).toBe(true);
  });

  it("degrades a missing observation table to an empty public lane", async () => {
    await expect(
      getPublicObservations(observationClient([], { message: "relation patch_observations does not exist" }) as never, "1.13.01"),
    ).resolves.toEqual([]);
  });
});

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
          source: "web_search",
          source_type: "web_search",
          title: "Possible Crimson Desert input issue after 1.13.01",
          summary: "A recent player mention.",
          source_url: "https://forum.example.com/current",
          source_published_at: "2026-07-09T00:00:00Z",
        },
        {
          cluster_id: "old",
          source: "web_search",
          source_type: "web_search",
          title: "Input issue in 1.12.00",
          summary: "An older patch mention.",
          source_url: "https://forum.example.com/old",
          source_published_at: "2026-06-01T00:00:00Z",
        },
        {
          cluster_id: "unsupported",
          source: "web_search",
          source_type: "web_search",
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

  it("excludes private Steam review context from radar candidate counts", () => {
    const counts = countCurrentPatchCandidateSignalsByCluster(
      [
        {
          cluster_id: "steam-context-only",
          title: "Crimson Desert player issue on Steam",
          summary: "Crimson Desert stutters after patch 1.13.01.",
          source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          source_published_at: "2026-07-09T00:00:00Z",
          source: "steam_review",
          source_type: "steam_review",
        },
      ],
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00Z" },
    );

    expect(counts).toEqual({});
  });

  it("paginates every private candidate before aggregating counts", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `candidate-${index}`,
      cluster_id: "cluster-one",
      source: "web_search",
      source_type: "web_search",
      title: "Crimson Desert input issue after 1.13.01",
      summary: "A current-patch player issue.",
      source_url: `https://forum.example.com/crimson-desert/${index}`,
      source_published_at: "2026-07-09T00:00:00Z",
    }));
    const secondPage = [
      {
        id: "candidate-1000",
        cluster_id: "cluster-two",
        source: "web_search",
        source_type: "web_search",
        title: "Crimson Desert crash after 1.13.01",
        summary: "A current-patch player issue.",
        source_url: "https://forum.example.com/crimson-desert/1000",
        source_published_at: "2026-07-09T00:00:00Z",
      },
    ];
    const pages = [firstPage, secondPage];
    const rangeCalls: [number, number][] = [];
    const supabase = {
      from(table: string) {
        expect(table).toBe("source_signals");
        return {
          select(columns: string) {
            expect(columns).toBe(
              "id, cluster_id, source, source_type, title, summary, source_url, source_published_at",
            );
            return {
              eq(column: string, value: string) {
                expect([column, value]).toEqual(["public_status", "private"]);
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

    const counts = await getCandidateSignalCountsByCluster(
      supabase as never,
      { version: "1.13.01", publishedAt: "2026-07-08T05:51:00Z" },
    );

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(counts).toEqual({ "cluster-one": 1000, "cluster-two": 1 });
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

describe("filterPublicCurrentPatchSignals", () => {
  it("revalidates stored public rows for game context and the Steam privacy boundary", () => {
    const base = {
      cluster_id: "cluster-one",
      category: "performance",
      confidence: "medium" as const,
      observed_at: "2026-07-22T12:00:00.000Z",
      source_published_at: "2026-07-22T10:00:00.000Z",
      public_status: "public" as const,
    };
    const rows = filterPublicCurrentPatchSignals(
      [
        {
          ...base,
          id: "valid",
          source: "web_search",
          source_url: "https://example.com/crimson-desert-performance",
          title: "Crimson Desert patch 1.13.01 FPS drops",
          summary: "Players report stutter after the current patch.",
        },
        {
          ...base,
          id: "protonmail",
          source: "web_search",
          source_url: "https://www.reddit.com/r/ProtonMail/comments/example/mcp",
          title: "Any plans for MCP?",
          summary: "A Proton Lumo feature request.",
        },
        {
          ...base,
          id: "pubg-spliced-snippet",
          source: "web_search",
          source_url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/example/guerilla_warfare_mortars",
          title: "guerilla warfare mortars off the roof : r/PUBATTLEGROUNDS",
          summary: "[Request] Pearl Abyss, please add one of these to r/CrimsonDesert.",
        },
        {
          ...base,
          id: "steam-private-context",
          source: "steam_review",
          source_url: "https://store.steampowered.com/app/3321460/Crimson_Desert",
          title: "Crimson Desert player issue on Steam",
          summary: "Players report stutter after patch 1.13.01.",
        },
      ],
      { version: "1.13.01", publishedAt: "2026-07-22T09:00:00.000Z" },
    );

    expect(rows.map((row) => row.id)).toEqual(["valid"]);
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
