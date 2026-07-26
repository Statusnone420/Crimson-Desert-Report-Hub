import { describe, expect, it } from "vitest";
import { readAdminClusters } from "@/lib/adminClusters";

type QueryResult = { data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null };
type RangeCall = { from: number; to: number; orders: string[] };

/**
 * Each select() consumes the next queued result. Range bounds and the order
 * columns chained before them are recorded so the tests can pin stable
 * title, id paging.
 */
function client(results: QueryResult[]) {
  let call = 0;
  const ranges: RangeCall[] = [];
  return {
    from: () => ({
      select: () => {
        const orders: string[] = [];
        const builder = {
          order: (column: string) => {
            orders.push(column);
            return builder;
          },
          range: async (from: number, to: number) => {
            ranges.push({ from, to, orders });
            return results[call++] ?? { data: [], error: null };
          },
        };
        return builder;
      },
    }),
    calls: () => call,
    ranges: () => ranges,
  };
}

function rows(start: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cluster-${String(start + index).padStart(4, "0")}`,
    title: `Cluster ${start + index}`,
    fix_status: "reported",
    admin_override: false,
    lifecycle_reason: null,
    admin_visibility_override: null,
    admin_visibility_reason: null,
    admin_visibility_changed_at: null,
    is_public: false,
  }));
}

describe("admin cluster paging", () => {
  it("assembles every page in stable title, id order past the hosted row cap", async () => {
    const fake = client([{ data: rows(0, 3), error: null }, { data: rows(3, 1), error: null }]);

    const result = await readAdminClusters(fake as never, 3);

    expect(result).toHaveLength(4);
    expect(result[3]).toMatchObject({ id: "cluster-0003" });
    expect(fake.ranges().map(({ from, to }) => [from, to])).toEqual([
      [0, 2],
      [3, 5],
    ]);
    for (const range of fake.ranges()) expect(range.orders).toEqual(["title", "id"]);
  });

  it("keeps a forced-visibility row reachable when it lands after the first page", async () => {
    // A truncated read would strip this row's only Reset to automatic control
    // and let Needs you render a false green zero.
    const forced = { ...rows(9, 1)[0], admin_visibility_override: "force_hidden", admin_override: true };
    const fake = client([{ data: rows(0, 2), error: null }, { data: [forced], error: null }]);

    const result = await readAdminClusters(fake as never, 2);

    expect(result).toHaveLength(3);
    expect(result.filter((cluster) => cluster.admin_visibility_override)).toHaveLength(1);
  });

  it("surfaces a failure on a later page instead of returning a partial ledger", async () => {
    const fake = client([
      { data: rows(0, 2), error: null },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ]);

    await expect(readAdminClusters(fake as never, 2)).rejects.toThrow(
      "admin clusters read failed: permission denied",
    );
  });
});

describe("admin cluster rolling migration compatibility", () => {
  it("uses the legacy projection only when a new audit column is missing", async () => {
    const fake = client([
      {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the admin_visibility_reason column of issue_clusters in the schema cache",
        },
      },
      {
        data: [{
          id: "cluster-one",
          title: "Mount lockup",
          fix_status: "reported",
          admin_override: false,
          lifecycle_reason: null,
          admin_visibility_override: null,
          is_public: false,
        }],
        error: null,
      },
    ]);

    const result = await readAdminClusters(fake as never);

    expect(fake.calls()).toBe(2);
    expect(result).toEqual([
      expect.objectContaining({
        id: "cluster-one",
        admin_visibility_reason: null,
        admin_visibility_changed_at: null,
      }),
    ]);
  });

  it("pages the legacy projection too", async () => {
    const legacyRow = (index: number) => ({
      id: `legacy-${index}`,
      title: `Legacy ${index}`,
      fix_status: "reported",
      admin_override: false,
      lifecycle_reason: null,
      admin_visibility_override: null,
      is_public: false,
    });
    const fake = client([
      {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the admin_visibility_reason column of issue_clusters in the schema cache",
        },
      },
      { data: [legacyRow(0), legacyRow(1)], error: null },
      { data: [legacyRow(2)], error: null },
    ]);

    const result = await readAdminClusters(fake as never, 2);

    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ id: "legacy-2", admin_visibility_reason: null });
  });

  it("surfaces permission errors instead of rendering a false empty ledger", async () => {
    const fake = client([{ data: null, error: { code: "42501", message: "permission denied" } }]);

    await expect(readAdminClusters(fake as never)).rejects.toThrow("admin clusters read failed: permission denied");
    expect(fake.calls()).toBe(1);
  });

  it("surfaces a legacy-query failure after a genuine missing-column retry", async () => {
    const fake = client([
      {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the admin_visibility_changed_at column of issue_clusters in the schema cache",
        },
      },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ]);

    await expect(readAdminClusters(fake as never)).rejects.toThrow(
      "admin clusters legacy read failed: permission denied",
    );
    expect(fake.calls()).toBe(2);
  });
});
