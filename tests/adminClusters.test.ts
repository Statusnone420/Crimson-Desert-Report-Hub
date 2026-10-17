import { describe, expect, it } from "vitest";
import { readAdminClusters } from "@/lib/adminClusters";

type QueryResult = { data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null };
type PageCall = { limit: number | null; after: string | null; ordered: string[] };

/**
 * Each select() consumes the next queued result and records the keyset cursor
 * it was asked for, so the tests can pin that paging walks by unique id rather
 * than by a shifting offset window.
 */
function client(results: QueryResult[]) {
  let call = 0;
  const pages: PageCall[] = [];
  return {
    from: () => ({
      select: () => {
        const page: PageCall = { limit: null, after: null, ordered: [] };
        const builder = {
          order: (column: string) => {
            page.ordered.push(column);
            return builder;
          },
          limit: (count: number) => {
            page.limit = count;
            return builder;
          },
          gt: (_column: string, value: string) => {
            page.after = value;
            return builder;
          },
          then: (resolve: (value: QueryResult) => unknown) => {
            pages.push(page);
            return Promise.resolve(resolve(results[call++] ?? { data: [], error: null }));
          },
        };
        return builder;
      },
    }),
    calls: () => call,
    pages: () => pages,
  };
}

function row(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `cluster-${String(index).padStart(4, "0")}`,
    title: `Cluster ${String(index).padStart(4, "0")}`,
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

describe("admin cluster paging", () => {
  it("walks by unique id cursor until an empty page and returns title order", async () => {
    const fake = client([
      { data: [row(2), row(1)], error: null },
      { data: [row(3)], error: null },
      { data: [], error: null },
    ]);

    const result = await readAdminClusters(fake as never, 2);

    expect(result.map((cluster) => cluster.id)).toEqual(["cluster-0001", "cluster-0002", "cluster-0003"]);
    expect(fake.pages().map((page) => page.after)).toEqual([null, "cluster-0001", "cluster-0003"]);
    for (const page of fake.pages()) {
      expect(page.ordered).toEqual(["id"]);
      expect(page.limit).toBe(2);
    }
  });

  it("keeps walking when the service returns fewer rows than requested", async () => {
    // The hosted row cap is configurable and may sit below pageSize; a short
    // page is not proof of the end, so only an empty page stops the walk.
    const fake = client([
      { data: [row(1)], error: null },
      { data: [row(2)], error: null },
      { data: [], error: null },
    ]);

    const result = await readAdminClusters(fake as never, 500);

    expect(result).toHaveLength(2);
    expect(fake.calls()).toBe(3);
  });

  it("keeps a forced-visibility row and an engine-owned exception reachable after page one", async () => {
    // The contract's multipage regression: a truncated read would strip the
    // forced row's only Reset control and let Needs you show a false zero.
    const forced = row(8, { admin_visibility_override: "force_hidden", admin_override: true });
    const unsure = row(9, { lifecycle_reason: "Needs review: official notes may claim this fix — unsure match." });
    const fake = client([
      { data: [row(1), row(2)], error: null },
      { data: [forced, unsure], error: null },
      { data: [], error: null },
    ]);

    const result = await readAdminClusters(fake as never, 2);

    expect(result.filter((cluster) => cluster.admin_visibility_override)).toHaveLength(1);
    expect(
      result.filter((cluster) => String(cluster.lifecycle_reason ?? "").startsWith("Needs review:")),
    ).toHaveLength(1);
  });

  it("surfaces a failure on a later page instead of returning a partial ledger", async () => {
    const fake = client([
      { data: [row(1)], error: null },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ]);

    await expect(readAdminClusters(fake as never, 1)).rejects.toThrow(
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
      { data: [], error: null },
    ]);

    const result = await readAdminClusters(fake as never);

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
      { data: [legacyRow(1), legacyRow(2)], error: null },
      { data: [legacyRow(3)], error: null },
      { data: [], error: null },
    ]);

    const result = await readAdminClusters(fake as never, 2);

    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({ id: "legacy-3", admin_visibility_reason: null });
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
