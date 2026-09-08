import { describe, expect, it } from "vitest";
import type { AdminClusterRow } from "@/lib/adminClusters";
import { countNeedsYou, readReportReviewQueue, retainFlaggedReports, splitClusterExceptions, type FlaggedReport } from "@/lib/reportReview";
import type { createServiceClient } from "@/lib/supabase";

type CountResult = { count: number | null; error: { message: string } | null };
type ListResult = { data: unknown[] | null; error: { message: string } | null };

const REPORT: FlaggedReport = {
  id: "report-1",
  created_at: "2026-09-08T12:00:00Z",
  patch_version: "1.13.01",
  platform: "pc_steam",
  category: "performance",
  severity: "medium",
  frequency: "often",
  issue_title: "Invented frame-rate report",
  description: "Private player text needed for moderation.",
  repro_steps: "Open the map.",
  hardware_specs: "Invented hardware details.",
  evidence_url: "https://example.test/private-evidence",
  cluster_id: null,
};
const OK_LIST: ListResult = { data: [REPORT], error: null };
const okCount = (count: number): CountResult => ({ count, error: null });
const FAILED = { message: "boom" };

/**
 * One builder per call, resolving to whichever result the test queued for that
 * moderation status. The flagged window is the only .order()/.limit() chain.
 */
function stubClient(results: {
  flagged?: ListResult;
  approved?: CountResult;
  pending?: CountResult;
  spam?: CountResult;
  selections?: string[];
}) {
  return {
    from: () => {
      let status = "";
      const builder = {
        select: (columns: string, options?: { head?: boolean }) => {
          results.selections?.push(columns);
          if (options?.head) builder.isCount = true;
          return builder;
        },
        isCount: false,
        eq: (_column: string, value: string) => {
          status = value;
          return builder;
        },
        order: () => builder,
        limit: () => Promise.resolve(results.flagged ?? OK_LIST),
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            status === "approved"
              ? (results.approved ?? okCount(4))
              : status === "pending"
                ? (results.pending ?? okCount(1))
                : (results.spam ?? okCount(0)),
          ),
      };
      return builder;
    },
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("readReportReviewQueue", () => {
  it("projects only editor fields and strips sensitive extras even if the database overreturns", async () => {
    const selections: string[] = [];
    const databaseRow = {
      ...REPORT,
      submitter_ip_hash: "private-network-hash",
      duplicate_fingerprint: "private-deduplication-fingerprint",
      future_private_metadata: { credential: "must-stay-server-side" },
    };
    const queue = await readReportReviewQueue(stubClient({
      flagged: { data: [databaseRow], error: null }, selections,
    }));

    expect(selections[0].split(/,\s*/).sort()).toEqual(Object.keys(REPORT).sort());
    expect(queue.flaggedReports).toStrictEqual([REPORT]);
    expect(queue.flaggedReports[0]).not.toBe(databaseRow);
    expect(JSON.stringify(queue)).not.toMatch(/private-network-hash|private-deduplication-fingerprint|must-stay-server-side/);
  });

  it("returns the flagged window with all four exact counts", async () => {
    const queue = await readReportReviewQueue(
      stubClient({ approved: okCount(9), pending: okCount(1), spam: okCount(3) }),
    );

    expect(queue.flaggedReports).toHaveLength(1);
    expect(queue.approvedCount).toBe(9);
    expect(queue.pendingCount).toBe(1);
    expect(queue.spamCount).toBe(3);
  });

  it.each([
    ["flagged reports", { flagged: { data: null, error: FAILED } }],
    ["approved count", { approved: { count: null, error: FAILED } }],
    ["pending count", { pending: { count: null, error: FAILED } }],
    ["spam count", { spam: { count: null, error: FAILED } }],
  ])("throws instead of fabricating a zero when the %s read fails", async (label, results) => {
    await expect(readReportReviewQueue(stubClient(results))).rejects.toThrow(`${label} read failed`);
  });

  it("throws when a count read succeeds without returning a number", async () => {
    // A null count with no error would otherwise render a green zero the data
    // cannot back.
    await expect(
      readReportReviewQueue(stubClient({ approved: { count: null, error: null } })),
    ).rejects.toThrow("approved count read returned no count");
  });
});

function cluster(id: string, overrides: Partial<AdminClusterRow> = {}): AdminClusterRow {
  return {
    id,
    title: `Cluster ${id}`,
    fix_status: "reported",
    admin_override: false,
    lifecycle_reason: null,
    admin_visibility_override: null,
    admin_visibility_reason: null,
    admin_visibility_changed_at: null,
    is_public: false,
    ...overrides,
  };
}

describe("splitClusterExceptions / countNeedsYou", () => {
  it("counts an engine-owned unsure match as required work", () => {
    const rows = [
      cluster("a"),
      cluster("b", { lifecycle_reason: "Needs review: official notes may claim this fix — unsure match." }),
    ];

    const split = splitClusterExceptions(rows);

    expect(split.exceptionRows).toHaveLength(1);
    expect(split.unsureClaimRows.map((row) => row.id)).toEqual(["b"]);
    expect(countNeedsYou(0, split.unsureClaimRows)).toBe(1);
  });

  it("shows a maintainer lock in the ledger without counting it as required work", () => {
    const split = splitClusterExceptions([cluster("c", { admin_override: true })]);

    expect(split.exceptionRows).toHaveLength(1);
    expect(split.unsureClaimRows).toHaveLength(0);
    expect(countNeedsYou(0, split.unsureClaimRows)).toBe(0);
  });

  it("cannot render a green zero when an unsure match arrives on a later cluster page", () => {
    // The paginated read returns page one's ordinary rows plus a later page's
    // exception; a truncated read would have produced Needs you = 0.
    const pageOne = [cluster("a"), cluster("b")];
    const pageTwo = [
      cluster("z", { lifecycle_reason: "Needs review: official notes may claim this fix — unsure match." }),
      cluster("y", { admin_visibility_override: "force_hidden", admin_override: true }),
    ];

    const split = splitClusterExceptions([...pageOne, ...pageTwo]);

    expect(countNeedsYou(0, split.unsureClaimRows)).toBe(1);
    expect(split.forcedRows.map((row) => row.id)).toEqual(["y"]);
  });

  it("adds flagged reports to cluster exceptions", () => {
    const split = splitClusterExceptions([
      cluster("b", { lifecycle_reason: "Needs review: unsure match." }),
    ]);

    expect(countNeedsYou(3, split.unsureClaimRows)).toBe(4);
  });

  it("keeps engine-owned rows out of the forced list so the browser only offers automatic clusters", () => {
    const split = splitClusterExceptions([
      cluster("a"),
      cluster("f", { admin_visibility_override: "force_public" }),
    ]);

    expect(split.forcedRows.map((row) => row.id)).toEqual(["f"]);
    expect(split.autoRows.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("retainFlaggedReports", () => {
  const report = (id: string) => ({
    id,
    created_at: "2026-09-07T12:00:00Z",
    patch_version: "1.14.00",
    platform: "pc_steam",
    category: "crash_startup",
    severity: "high",
    frequency: "always",
    issue_title: id,
    description: "Invented fixture.",
    repro_steps: null,
    hardware_specs: null,
    evidence_url: null,
    cluster_id: null,
  });

  it("keeps a report that arrived after the first snapshot so excerpt retry can still find it", () => {
    const first = retainFlaggedReports([report("a")], [report("a"), report("b")]);
    const afterApproval = retainFlaggedReports(first, [report("a")]);

    expect(afterApproval.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
