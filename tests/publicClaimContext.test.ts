import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimReviewKey } from "@/lib/claimReview";
import { readPublicClaimContext, type PublicClaimCluster } from "@/lib/publicClaimContext.server";

type Row = Record<string, unknown>;
type ReadError = { code?: string; message?: string };

const patch = { version: "2.02.00", officialUrl: "https://official.example/2-02" };
const cluster: PublicClaimCluster = {
  id: "cluster-1", is_public: true, admin_override: false,
  fix_claimed_at: "2026-09-12T00:00:00Z", fix_claimed_patch_version: patch.version,
};

function clientFor(options: {
  board?: Row[] | null;
  fixes?: Row[] | null;
  pairings?: Row[] | null;
  syncState?: Row[] | null;
  errors?: Partial<Record<"official_patch_notes" | "official_patch_claimed_fixes" | "claim_review_pairings" | "claim_review_sync_state", ReadError>>;
  pageSize?: number;
} = {}): SupabaseClient {
  const board = options.board === undefined ? [{ board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, is_current: true }] : options.board;
  const fixes = options.fixes === undefined ? [{ id: "fix-1", board_no: "board-2", fix_text: "Fixed a crash.", section: "Stability" }] : options.fixes;
  const pairings = options.pairings === undefined ? [{
    id: "pairing-1", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a crash."), state: "confirmed",
    board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a crash.",
  }] : options.pairings;
  const syncState = options.syncState === undefined ? [{ first_synced_at: "2026-09-12T00:00:00Z" }] : options.syncState;
  const pageSize = options.pageSize ?? 500;

  return {
    from: (table: string) => {
      let after: string | null = null;
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        order: () => query,
        limit: () => query,
        gt: (_column: string, value: string) => {
          after = value;
          return query;
        },
        then: (resolve: (value: { data: Row[] | null; error: ReadError | null }) => unknown) => {
          const rows = table === "claim_review_sync_state" ? syncState : table === "official_patch_notes" ? board : table === "official_patch_claimed_fixes" ? fixes : pairings;
          const error = options.errors?.[table as keyof NonNullable<typeof options.errors>] ?? null;
          const filtered = rows === null ? null : rows.filter((row) =>
            Object.entries(filters).every(([column, value]) => row[column] === value),
          );
          const data = filtered === null ? null : (table === "official_patch_notes" || table === "claim_review_sync_state" ? filtered : filtered.filter((row) => String(row.id) > (after ?? "")).slice(0, pageSize));
          return Promise.resolve({ data, error }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("public claim context", () => {
  it("marks a migrated empty store unavailable before its first durable sync", async () => {
    await expect(readPublicClaimContext(clientFor({ syncState: [], pairings: [] }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: true });
  });

  it("does not infer sync readiness from the presence of pairings", async () => {
    await expect(readPublicClaimContext(clientFor({ syncState: [] }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: true });
  });

  it("accepts an empty confirmed-pairing result after durable sync", async () => {
    await expect(readPublicClaimContext(clientFor({ pairings: [] }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: false });
  });

  it("keeps a missing sync-state table unavailable", async () => {
    await expect(readPublicClaimContext(clientFor({ errors: {
      claim_review_sync_state: { code: "PGRST205", message: "Could not find the table 'public.claim_review_sync_state' in the schema cache" },
    } }), patch, [cluster])).resolves.toEqual({ byCluster: {}, unavailable: true });
  });

  it("keeps a null sync-state response unavailable", async () => {
    await expect(readPublicClaimContext(clientFor({ syncState: null }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: true });
  });

  it("uses only a current confirmed pairing and fresh official fields", async () => {
    const result = await readPublicClaimContext(clientFor({
      pairings: [{
        id: "pairing-1", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a  crash."), state: "confirmed",
        board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a  crash.",
      }],
    }), patch, [cluster]);

    expect(result).toEqual({
      unavailable: false,
      byCluster: {
        "cluster-1": [{ key: claimReviewKey(patch.version, "Fixed a crash."), text: "Fixed a crash.", section: "Stability", officialUrl: patch.officialUrl }],
      },
    });
  });

  it("rejects mismatched current board, patch, URL, key, or normalized text", async () => {
    const base = {
      id: "pairing-1", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a crash."), state: "confirmed",
      board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a crash.",
    };
    const variants = [
      { ...base, board_no: "board-old" },
      { ...base, patch_version: "2.01.00" },
      { ...base, official_url: "https://official.example/old" },
      { ...base, claim_key: claimReviewKey(patch.version, "Another fix.") },
      { ...base, exact_official_text: "Another fix." },
    ];

    for (const pairing of variants) {
      await expect(readPublicClaimContext(clientFor({ pairings: [pairing] }), patch, [cluster]))
        .resolves.toEqual({ byCluster: {}, unavailable: false });
    }
  });

  it("excludes pending, rejected, retired, private, locked, and stale-clock clusters", async () => {
    for (const state of ["pending", "rejected", "retired"]) {
      const pairing = {
        id: "pairing-1", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a crash."), state,
        board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a crash.",
      };
      await expect(readPublicClaimContext(clientFor({ pairings: [pairing] }), patch, [cluster]))
        .resolves.toEqual({ byCluster: {}, unavailable: false });
    }

    for (const excluded of [
      { ...cluster, is_public: false },
      { ...cluster, admin_override: true },
      { ...cluster, fix_claimed_at: null },
      { ...cluster, fix_claimed_patch_version: "2.01.00" },
    ]) {
      await expect(readPublicClaimContext(clientFor(), patch, [excluded]))
        .resolves.toEqual({ byCluster: {}, unavailable: false });
    }
  });

  it("keeps multiple confirmed claims and deduplicates a claim per cluster", async () => {
    const second = { id: "fix-2", board_no: "board-2", fix_text: "Fixed an animation.", section: null };
    const result = await readPublicClaimContext(clientFor({
      pageSize: 1,
      fixes: [{ id: "fix-1", board_no: "board-2", fix_text: "Fixed a crash.", section: "Stability" }, second],
      pairings: [
        { id: "pairing-1", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a crash."), state: "confirmed", board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a crash." },
        { id: "pairing-2", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, second.fix_text), state: "confirmed", board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: second.fix_text },
        { id: "pairing-3", cluster_id: cluster.id, claim_key: claimReviewKey(patch.version, "Fixed a crash."), state: "confirmed", board_no: "board-2", patch_version: patch.version, official_url: patch.officialUrl, exact_official_text: "Fixed a crash." },
      ],
    }), patch, [cluster]);

    expect(result.unavailable).toBe(false);
    expect(result.byCluster[cluster.id]).toEqual([
      { key: claimReviewKey(patch.version, "Fixed a crash."), text: "Fixed a crash.", section: "Stability", officialUrl: patch.officialUrl },
      { key: claimReviewKey(patch.version, second.fix_text), text: second.fix_text, section: null, officialUrl: patch.officialUrl },
    ]);
  });

  it("fails closed for a mismatched board identity, malformed read, and every read error", async () => {
    await expect(readPublicClaimContext(clientFor({ board: [{ board_no: "board-2", patch_version: patch.version, official_url: "https://official.example/other", is_current: true }] }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: true });
    await expect(readPublicClaimContext(clientFor({ fixes: null }), patch, [cluster]))
      .resolves.toEqual({ byCluster: {}, unavailable: true });

    for (const table of ["official_patch_notes", "official_patch_claimed_fixes", "claim_review_pairings", "claim_review_sync_state"] as const) {
      await expect(readPublicClaimContext(clientFor({ errors: { [table]: { code: "42501", message: "permission denied" } } }), patch, [cluster]))
        .resolves.toEqual({ byCluster: {}, unavailable: true });
    }
  });
});
