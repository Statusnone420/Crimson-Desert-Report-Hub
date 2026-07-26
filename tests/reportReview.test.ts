import { describe, expect, it } from "vitest";
import { readReportReviewQueue } from "@/lib/reportReview";
import type { createServiceClient } from "@/lib/supabase";

type CountResult = { count: number | null; error: { message: string } | null };
type ListResult = { data: unknown[] | null; error: { message: string } | null };

const OK_LIST: ListResult = { data: [{ id: "report-1" }], error: null };
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
}) {
  return {
    from: () => {
      let status = "";
      const builder = {
        select: (_columns: string, options?: { head?: boolean }) => {
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
