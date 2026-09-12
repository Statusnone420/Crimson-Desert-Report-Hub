import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Checkin = {
  id: string;
  cluster_id: string;
  patch_version: string;
  platform: string;
  kind: "have_it" | "not_happening" | "still_happening" | "fixed_for_me";
  voter_ip_hash: string;
  created_at: string;
};

function clientFor(rows: Checkin[], error: { code?: string; message: string } | null = null) {
  const calls: { select: string[]; eq: [string, string][]; order: [string, { ascending: boolean }][]; range: [number, number][]; limit: number[] } = {
    select: [], eq: [], order: [], range: [], limit: [],
  };
  let patchVersion: string | null = null;
  let clusterId: string | null = null;
  const query = {
    select(columns: string) {
      calls.select.push(columns);
      return query;
    },
    eq(column: string, value: string) {
      calls.eq.push([column, value]);
      if (column === "patch_version") patchVersion = value;
      if (column === "cluster_id") clusterId = value;
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.order.push([column, options]);
      return query;
    },
    range(from: number, to: number) {
      calls.range.push([from, to]);
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rows.filter((row) => row.patch_version === patchVersion).slice(from, to + 1), error: null });
    },
    limit(count: number) {
      calls.limit.push(count);
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rows.filter((row) => row.patch_version === patchVersion && row.cluster_id === clusterId).slice(0, count), error: null });
    },
  };
  return { client: { from: vi.fn(() => query) }, calls };
}

const checkin = (id: string, clusterId: string, patchVersion = "2.02.00"): Checkin => ({
  id,
  cluster_id: clusterId,
  patch_version: patchVersion,
  platform: "pc_steam",
  kind: "have_it",
  voter_ip_hash: `hash-${id}`,
  created_at: "2026-09-12T12:00:00.000Z",
});

describe("check-in reads", () => {
  it("reads every exact-patch page in id order and keeps hashes for later aggregate counting", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, index) => checkin(`a-${String(index).padStart(4, "0")}`, "cluster-a")),
      checkin("b-0001", "cluster-b"),
      checkin("old-0001", "cluster-a", "2.01.00"),
    ];
    const { client, calls } = clientFor(rows);
    const { readCheckinsForPatch } = await import("@/lib/checkins.server");

    const result = await readCheckinsForPatch(client as never, "2.02.00");

    expect(result.available).toBe(true);
    expect(result.byCluster["cluster-a"]).toHaveLength(1000);
    expect(result.byCluster["cluster-b"]).toEqual([expect.objectContaining({ id: "b-0001", voter_ip_hash: "hash-b-0001" })]);
    expect(calls.select).toEqual([
      "id, cluster_id, platform, kind, voter_ip_hash, created_at",
      "id, cluster_id, platform, kind, voter_ip_hash, created_at",
    ]);
    expect(calls.eq).toEqual([["patch_version", "2.02.00"], ["patch_version", "2.02.00"]]);
    expect(calls.order).toEqual([["id", { ascending: true }], ["id", { ascending: true }]]);
    expect(calls.range).toEqual([[0, 999], [1000, 1999]]);
  });

  it("treats only a missing issue_checkins relation as unavailable", async () => {
    const { client } = clientFor([], { code: "42P01", message: 'relation "issue_checkins" does not exist' });
    const { readCheckinsForPatch, hasCurrentPatchCheckins } = await import("@/lib/checkins.server");

    await expect(readCheckinsForPatch(client as never, "2.02.00")).resolves.toEqual({ byCluster: {}, available: false });
    await expect(hasCurrentPatchCheckins(client as never, "cluster-a", "2.02.00")).resolves.toBe(false);
  });

  it.each([
    { code: "42501", message: "permission denied for table issue_checkins" },
    { code: "42P01", message: 'relation "other_table" does not exist' },
  ])("throws non-migration failures instead of treating them as no check-ins", async (error) => {
    const { client } = clientFor([], error);
    const { readCheckinsForPatch, hasCurrentPatchCheckins } = await import("@/lib/checkins.server");

    await expect(readCheckinsForPatch(client as never, "2.02.00")).rejects.toThrow(/check-ins read failed/);
    await expect(hasCurrentPatchCheckins(client as never, "cluster-a", "2.02.00")).rejects.toThrow(/check-in retention read failed/);
  });

  it("finds only a current exact-patch response for retention", async () => {
    const { client, calls } = clientFor([
      checkin("current", "cluster-a"),
      checkin("old", "cluster-a", "2.01.00"),
      checkin("other-cluster", "cluster-b"),
    ]);
    const { hasCurrentPatchCheckins } = await import("@/lib/checkins.server");

    await expect(hasCurrentPatchCheckins(client as never, "cluster-a", "2.02.00")).resolves.toBe(true);
    await expect(hasCurrentPatchCheckins(client as never, "cluster-b", "2.02.00")).resolves.toBe(true);
    await expect(hasCurrentPatchCheckins(client as never, "cluster-c", "2.02.00")).resolves.toBe(false);
    expect(calls.eq).toEqual([
      ["cluster_id", "cluster-a"], ["patch_version", "2.02.00"],
      ["cluster_id", "cluster-b"], ["patch_version", "2.02.00"],
      ["cluster_id", "cluster-c"], ["patch_version", "2.02.00"],
    ]);
    expect(calls.limit).toEqual([1, 1, 1]);
  });
});
