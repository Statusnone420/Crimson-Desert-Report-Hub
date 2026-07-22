import { describe, expect, it } from "vitest";
import { readAdminClusters } from "@/lib/adminClusters";

type QueryResult = { data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null };

function client(results: QueryResult[]) {
  let call = 0;
  return {
    from: () => ({
      select: () => ({
        order: async () => results[call++] ?? { data: [], error: null },
      }),
    }),
    calls: () => call,
  };
}

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

    const rows = await readAdminClusters(fake as never);

    expect(fake.calls()).toBe(2);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "cluster-one",
        admin_visibility_reason: null,
        admin_visibility_changed_at: null,
      }),
    ]);
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
