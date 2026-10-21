import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

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
  const calls: { select: string[]; eq: [string, string][]; in: [string, string[]][]; order: [string, { ascending: boolean }][]; range: [number, number][]; limit: number[] } = {
    select: [], eq: [], in: [], order: [], range: [], limit: [],
  };
  let patchVersion: string | null = null;
  let clusterId: string | null = null;
  let kinds: string[] | null = null;
  const matches = (row: Checkin) => row.patch_version === patchVersion && (kinds === null || kinds.includes(row.kind));
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
    in(column: string, values: string[]) {
      calls.in.push([column, values]);
      if (column === "kind") kinds = values;
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.order.push([column, options]);
      return query;
    },
    range(from: number, to: number) {
      calls.range.push([from, to]);
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rows.filter((row) => matches(row) && (clusterId === null || row.cluster_id === clusterId)).slice(from, to + 1), error: null });
    },
    limit(count: number) {
      calls.limit.push(count);
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: rows.filter((row) => matches(row) && row.cluster_id === clusterId).slice(0, count), error: null });
    },
  };
  return { client: { from: vi.fn(() => query) }, calls };
}

const checkin = (id: string, clusterId: string, patchVersion = "2.02.00"): Checkin => ({
  id,
  cluster_id: clusterId,
  patch_version: patchVersion,
  platform: "pc_steam",
  kind: "still_happening",
  voter_ip_hash: `hash-${id}`,
  created_at: "2026-09-12T12:00:00.000Z",
});

function receiptClient(rows: Checkin[], response: "ok" | "denied" | "missing-count" | "changed-claim" = "ok", claim: { fix_claimed_at: string | null; fix_claimed_patch_version: string | null } = { fix_claimed_at: "2026-09-01T00:00:00Z", fix_claimed_patch_version: "2.02.00" }) {
  const requests: Request[] = [];
  const client = createClient("https://receipt.test", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (response === "denied") return new Response(null, { status: 403 });
      const url = new URL(request.url);
      const query = url.searchParams;
      const result: Record<string, unknown> = { is_public: true, ...claim };
      const fields = new Set((query.get("select") ?? "").split(","));
      const embeds = ["have_it", "not_happening", "still_happening", "fixed_for_me", "totalCount"].filter((alias) => fields.has(`${alias}:issue_checkins(count)`));
      const filterMatches = (filter: string | null, value: string) => filter === null || filter === `eq.${value}`
        || (filter.startsWith("in.(") && filter.slice(4, -1).split(",").includes(value));
      for (const alias of embeds) {
        const count = rows.filter((row) => query.get("id") === `eq.${row.cluster_id}`
          && ["patch_version", "kind"].every((key) => filterMatches(query.get(`${alias}.${key}`), row[key as keyof Checkin]))
          && (!query.has(`${alias}.created_at`) || Date.parse(row.created_at) >= Date.parse(query.get(`${alias}.created_at`)!.slice(4))),
        ).length;
        result[alias] = [{ count: response === "missing-count" ? null : count }];
      }
      if (embeds.length && response === "changed-claim") result.fix_claimed_at = "2026-09-13T00:00:00Z";
      return new Response(JSON.stringify([result]), { headers: { "content-type": "application/json" } });
    } },
  });
  return { client, requests };
}

describe("check-in reads", () => {
  it("reads every receipt count in one bounded aggregate snapshot regardless of ledger size", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, index) => checkin(`a-${index}`, "cluster-a")),
      { ...checkin("fixed", "cluster-a"), kind: "fixed_for_me" as const },
      // General answers became thumbs: they stay stored and never enter a receipt.
      { ...checkin("general-yes", "cluster-a"), kind: "have_it" as const },
      { ...checkin("general-no", "cluster-a"), kind: "not_happening" as const },
      checkin("unrelated", "cluster-b"),
      checkin("old", "cluster-a", "2.01.00"),
    ];
    const { client, requests } = receiptClient(rows);
    const { readCheckinCounts } = await import("@/lib/checkins.server");
    expect(await readCheckinCounts(client as never, "cluster-a", "2.02.00")).toEqual({
      totalCount: 1001, fixed_for_me: 1, still_happening: 1000,
    });
    expect(requests).toHaveLength(2); // claim boundary, then all counts together
    const snapshot = new URL(requests[1].url).searchParams;
    expect(requests[1].method).toBe("GET");
    expect(snapshot.get("select")).toBe("fix_claimed_at,fix_claimed_patch_version,fixed_for_me:issue_checkins(count),still_happening:issue_checkins(count),totalCount:issue_checkins(count)");
    expect(snapshot.get("totalCount.kind")).toBe("in.(fixed_for_me,still_happening)");
    expect(snapshot.get("id")).toBe("eq.cluster-a");
    expect(snapshot.get("is_public")).toBe("eq.true");
    expect(snapshot.get("limit")).toBe("1");
  });

  it.each([
    { fix_claimed_at: "2026-09-12T12:00:00Z", fix_claimed_patch_version: "2.02.00", fixed: 1, still: 1 },
    { fix_claimed_at: "2026-09-12T12:00:00Z", fix_claimed_patch_version: "2.01.00", fixed: 0, still: 0 },
    { fix_claimed_at: null, fix_claimed_patch_version: null, fixed: 0, still: 0 },
  ])("preserves the board's claim-date boundary for poll counts: $fix_claimed_patch_version / $fix_claimed_at", async (claim) => {
    const rows: Checkin[] = [
      { ...checkin("general", "cluster-a"), kind: "have_it" },
      { ...checkin("before", "cluster-a"), kind: "fixed_for_me", created_at: "2026-09-12T11:59:59Z" },
      { ...checkin("boundary", "cluster-a"), kind: "fixed_for_me" },
      { ...checkin("after", "cluster-a"), kind: "still_happening", created_at: "2026-09-12T12:00:01Z" },
    ];
    const { client } = receiptClient(rows, "ok", claim);
    const { readCheckinCounts } = await import("@/lib/checkins.server");
    expect(await readCheckinCounts(client, "cluster-a", "2.02.00")).toEqual({
      totalCount: 3, fixed_for_me: claim.fixed, still_happening: claim.still,
    });
  });

  it("does not turn failed or missing receipt counts into zero totals", async () => {
    const { readCheckinCounts } = await import("@/lib/checkins.server");
    const denied = receiptClient([], "denied");
    await expect(readCheckinCounts(denied.client as never, "cluster-a", "2.02.00")).rejects.toThrow("could not be read");
    const missing = receiptClient([], "missing-count");
    await expect(readCheckinCounts(missing.client as never, "cluster-a", "2.02.00")).rejects.toThrow("could not be read");
  });

  it("declines totals if the claim boundary changes while preparing the snapshot query", async () => {
    const { client } = receiptClient([checkin("current", "cluster-a")], "changed-claim");
    const { readCheckinCounts } = await import("@/lib/checkins.server");
    await expect(readCheckinCounts(client, "cluster-a", "2.02.00")).rejects.toThrow("could not be read");
  });

  it("reads every exact-patch page in id order and keeps hashes for later aggregate counting", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, (_, index) => checkin(`a-${String(index).padStart(4, "0")}`, "cluster-a")),
      checkin("b-0001", "cluster-b"),
      { ...checkin("b-general", "cluster-b"), kind: "have_it" as const },
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
    expect(calls.in).toEqual([["kind", ["fixed_for_me", "still_happening"]], ["kind", ["fixed_for_me", "still_happening"]]]);
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

  it("finds only a current exact-patch answer to a fix claim for retention", async () => {
    const { client, calls } = clientFor([
      checkin("current", "cluster-a"),
      checkin("old", "cluster-a", "2.01.00"),
      { ...checkin("other-cluster", "cluster-b"), kind: "fixed_for_me" },
      { ...checkin("general-yes", "cluster-c"), kind: "have_it" },
      { ...checkin("general-no", "cluster-c"), kind: "not_happening" },
    ]);
    const { hasCurrentPatchCheckins } = await import("@/lib/checkins.server");

    await expect(hasCurrentPatchCheckins(client as never, "cluster-a", "2.02.00")).resolves.toBe(true);
    await expect(hasCurrentPatchCheckins(client as never, "cluster-b", "2.02.00")).resolves.toBe(true);
    // A general answer, now a thumb, keeps nothing on the board.
    await expect(hasCurrentPatchCheckins(client as never, "cluster-c", "2.02.00")).resolves.toBe(false);
    expect(calls.eq).toEqual([
      ["cluster_id", "cluster-a"], ["patch_version", "2.02.00"],
      ["cluster_id", "cluster-b"], ["patch_version", "2.02.00"],
      ["cluster_id", "cluster-c"], ["patch_version", "2.02.00"],
    ]);
    expect(calls.limit).toEqual([1, 1, 1]);
  });
});
