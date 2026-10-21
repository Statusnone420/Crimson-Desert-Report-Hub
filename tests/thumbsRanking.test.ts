import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { needsFullIssueCard } from "@/lib/evidence";
import { boardOrder, THUMBS_BONUS_MIN_UPS, THUMBS_RANK_BONUS, thumbsRankBonus } from "@/lib/thumbs";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code?: string; message: string }>,
  reads: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: (table: string) => query(table) }),
  hasSupabaseServiceConfig: () => true,
}));
vi.mock("@/lib/officialPatch.server", () => ({
  getCurrentPatchMetadata: async () => ({
    version: "2.03.02", title: "Patch 2.03.02", officialUrl: "https://example.com/notes",
    publishedAt: "2026-10-08T00:00:00.000Z", summary: null, source: "official",
  }),
  readClaimedFixesForCurrentPatch: async () => ({ fixes: [], totalClaimedFixes: 0 }),
}));
vi.mock("@/lib/publicClaimContext.server", () => ({
  readPublicClaimContext: async () => ({ byCluster: {}, unavailable: false }),
}));

/** Equality filters on a row's own columns; everything else passes through. */
function query(table: string) {
  db.reads.push(table);
  const filters: [string, unknown][] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "range", "limit", "in", "gte", "neq", "not"]) chain[method] = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown) => {
    const failure = db.failures[table];
    const rows = (db.tables[table] ?? []).filter((row) => filters.every(([column, value]) => !(column in row) || row[column] === value));
    return Promise.resolve(failure ? { data: null, error: failure } : { data: rows, error: null }).then(resolve);
  };
  return chain;
}

const cluster = (id: string): Row => ({
  id, slug: id, title: `Crimson Desert ${id}`, category: "crash_startup", description: "", fix_status: "reported",
  confidence: "medium", is_public: true, created_at: "2026-10-09T00:00:00.000Z",
});

const signal = (id: string, clusterId: string, publicStatus: "public" | "private" = "public"): Row => ({
  id, cluster_id: clusterId, source: "web_search", source_type: "web_search",
  source_url: `https://steamcommunity.com/app/3321460/discussions/0/${id}/`,
  title: "Crimson Desert map crash on PS5", summary: "The map crashes the game on PS5 since patch 2.03.02.",
  category: "crash_startup", confidence: "high", observed_at: "2026-10-10T00:00:00.000Z",
  source_published_at: "2026-10-09T12:00:00.000Z", public_status: publicStatus, extracted_facts: {},
});

const thumbs = (clusterId: string, up: number, down: number): Row[] => [
  ...Array.from({ length: up }, (_, index) => ({ id: `${clusterId}-up-${index}`, cluster_id: clusterId, patch_version: "2.03.02", direction: "up" })),
  ...Array.from({ length: down }, (_, index) => ({ id: `${clusterId}-down-${index}`, cluster_id: clusterId, patch_version: "2.03.02", direction: "down" })),
];

beforeEach(() => {
  db.reads.length = 0;
  db.failures = {};
  db.tables = {
    // The thumbs topic comes last among equal evidence, so only the bonus can lift it.
    issue_clusters: ["more-posts", "one-post", "nine-ups", "tied", "one-post-thumbs", "thumbs-only"].map(cluster),
    bug_reports: [],
    source_signals: [
      signal("101", "more-posts"), signal("102", "more-posts"),
      signal("201", "one-post-thumbs"),
      signal("301", "one-post"),
      signal("401", "nine-ups"),
      signal("501", "tied"),
      signal("601", "thumbs-only", "private"),
    ],
    issue_confirmations: [],
    issue_checkins: [],
    issue_thumbs: [
      ...thumbs("one-post-thumbs", THUMBS_BONUS_MIN_UPS, 2),
      ...thumbs("nine-ups", THUMBS_BONUS_MIN_UPS - 1, 0),
      ...thumbs("tied", THUMBS_BONUS_MIN_UPS, THUMBS_BONUS_MIN_UPS),
      ...thumbs("thumbs-only", 50, 0),
    ],
    approved_excerpts: [],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function board() {
  const { getIssuesData } = await import("@/lib/queries");
  const data = await getIssuesData();
  const byId = Object.fromEntries(data.clusters.map((item) => [item.id, item]));
  return {
    data,
    byId,
    evidenceOrder: data.clusters.map((item) => item.id),
    order: boardOrder(data.clusters).map((item) => item.id),
  };
}

const EVIDENCE_ORDER = ["more-posts", "one-post", "nine-ups", "tied", "one-post-thumbs", "thumbs-only"];

describe("thumbs rank bonus", () => {
  it(`starts at ${THUMBS_BONUS_MIN_UPS} thumbs up and needs more ups than downs`, () => {
    expect(THUMBS_BONUS_MIN_UPS).toBe(10);
    expect(thumbsRankBonus(undefined)).toBe(0);
    expect(thumbsRankBonus({ up: 9, down: 0 })).toBe(0);
    expect(thumbsRankBonus({ up: 10, down: 9 })).toBe(THUMBS_RANK_BONUS);
    expect(thumbsRankBonus({ up: 10, down: 10 })).toBe(0);
    expect(thumbsRankBonus({ up: 10, down: 11 })).toBe(0);
    expect(thumbsRankBonus({ up: 500, down: 0 })).toBe(THUMBS_RANK_BONUS);
    // Smaller than one post or report, so it only orders topics with equal evidence.
    expect(THUMBS_RANK_BONUS).toBeLessThan(1);
  });

  it("orders equal evidence on the board and never outranks more evidence", async () => {
    const { byId, order } = await board();

    expect(byId["one-post-thumbs"]).toMatchObject({ strengthScore: 1, rankScore: 1 + THUMBS_RANK_BONUS });
    expect(byId["nine-ups"]).toMatchObject({ strengthScore: 1, rankScore: 1 });
    expect(byId["tied"]).toMatchObject({ strengthScore: 1, rankScore: 1 });
    expect(order).toEqual(["more-posts", "one-post-thumbs", "one-post", "nine-ups", "tied", "thumbs-only"]);
  });

  it("keeps the shared issue read in evidence order, so only the board's order uses thumbs", async () => {
    const withThumbs = await board();
    db.tables.issue_thumbs = [];
    const withoutThumbs = await board();

    // The column's fact pack and the scanner's count read this list.
    expect(withThumbs.evidenceOrder).toEqual(EVIDENCE_ORDER);
    expect(withoutThumbs.evidenceOrder).toEqual(EVIDENCE_ORDER);
    expect(withoutThumbs.order).toEqual(EVIDENCE_ORDER);
    expect(withThumbs.data.thumbsAvailable).toBe(true);
    expect(withoutThumbs.data.thumbsAvailable).toBe(true);
  });

  it("never publishes a topic on thumbs alone", async () => {
    const { byId } = await board();

    expect(byId["thumbs-only"]).toMatchObject({ strengthScore: 0, rankScore: THUMBS_RANK_BONUS, candidateSignalCount: 1 });
    expect(needsFullIssueCard(byId["thumbs-only"])).toBe(false);
    expect(needsFullIssueCard(byId["one-post-thumbs"])).toBe(true);
  });

  it("keeps thumb totals out of the board data", async () => {
    const { data } = await board();

    expect(db.reads).toContain("issue_thumbs");
    for (const item of data.clusters) expect(Object.keys(item)).not.toContain("thumbs");
    expect(JSON.stringify(data)).not.toMatch(/"(?:up|down)":\s*\d/);
  });

  it("reports thumbs unavailable, orders on evidence alone and logs when they cannot be read", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    db.failures.issue_thumbs = { code: "42501", message: "permission denied for table issue_thumbs" };

    const { data, byId, order } = await board();

    expect(data.thumbsAvailable).toBe(false);
    expect(data.boardReadFailed).toBe(false);
    expect(byId["one-post-thumbs"]).toMatchObject({ strengthScore: 1, rankScore: 1 });
    expect(byId["thumbs-only"]).toMatchObject({ rankScore: 0 });
    expect(order).toEqual(EVIDENCE_ORDER);
    expect(errorLog).toHaveBeenCalledWith("[thumbs] Current-patch thumbs unavailable; the board orders on evidence alone", expect.any(Error));
  });

  it("reports thumbs unavailable before the thumbs migration, without an error log", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    db.failures.issue_thumbs = { code: "PGRST205", message: "Could not find the table 'public.issue_thumbs' in the schema cache" };

    const { data, byId, order } = await board();

    expect(data.thumbsAvailable).toBe(false);
    expect(byId["one-post-thumbs"]).toMatchObject({ rankScore: 1 });
    expect(order).toEqual(EVIDENCE_ORDER);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
