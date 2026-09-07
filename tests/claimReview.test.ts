import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyClaimReviewDecision, claimReviewKey, normalizeClaimReviewText, readClaimReviewQueue, recordClaimReviewProposals } from "@/lib/claimReview";

type Row = Record<string, unknown>;

function pairingRow(id: string): Row {
  return {
    id, pairing_key: `key-${id}`, claim_key: `claim-${id}`, revision: 1, state: "confirmed", board_no: "board", patch_version: "1.14.00",
    official_url: "https://official.example/patch", exact_official_text: "Fixed a crash.", official_section: "Stability",
    cluster_id: "00000000-0000-4000-8000-000000000001", cluster_slug: "crash", cluster_title: "Crash", cluster_category: "crash_startup", proposal_kind: "llm_sure",
    proposal_reason: "Exact mapping.", first_seen_at: "2026-09-07T12:00:00Z", last_seen_at: "2026-09-07T12:00:00Z", seen_count: 1,
    seen_by_operator_at: null, rejected_reason: null, confirmed_at: "2026-09-07T12:00:00Z", retired_at: null, retired_reason: null,
    cluster_lifecycle_revision: 1,
  };
}

type MockError = { code?: string; message?: string };

type PagingOptions = {
  currentContext?: boolean;
  nullPairingRead?: boolean;
  nullCurrentPatchRead?: boolean;
  cap?: number;
  /** Defaults to a recorded durable sync so existing reads stay available. */
  syncState?: "synced" | "awaiting" | "missing" | "denied";
  legacyRows?: Row[];
};

function pagingClient(rows: Row[], options: PagingOptions = {}) {
  const cursors: (string | null)[] = [];
  const cap = options.cap ?? 500;
  const client = {
    from: (table: string) => {
      let after: string | null = null;
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: () => query,
        like: () => query,
        gt: (_column: string, value: string) => {
          after = value;
          return query;
        },
        then: (resolve: (value: { data: Row[] | null; error: MockError | null }) => unknown) => {
          if (table === "claim_review_sync_state") {
            if (options.syncState === "missing") {
              return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.claim_review_sync_state' in the schema cache" } }).then(resolve);
            }
            if (options.syncState === "denied") {
              return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for table claim_review_sync_state" } }).then(resolve);
            }
            if (options.syncState === "awaiting") return Promise.resolve({ data: [], error: null }).then(resolve);
            return Promise.resolve({ data: [{ first_synced_at: "2026-09-07T12:00:00Z" }], error: null }).then(resolve);
          }
          if (table === "issue_clusters" && options.legacyRows) {
            const page = options.legacyRows.filter((row) => String(row.id) > (after ?? ""));
            return Promise.resolve({ data: page, error: null }).then(resolve);
          }
          if (table === "claim_review_pairings") {
            cursors.push(after);
            if (options.nullPairingRead) return Promise.resolve({ data: null, error: null }).then(resolve);
            const page = rows.filter((row) => String(row.id) > (after ?? "")).slice(0, cap);
            return Promise.resolve({ data: page, error: null }).then(resolve);
          }
          if (table === "official_patch_notes" && options.nullCurrentPatchRead) return Promise.resolve({ data: null, error: null }).then(resolve);
          if (options.currentContext && table === "official_patch_notes") {
            return Promise.resolve({ data: [{ board_no: "board", patch_version: "1.14.00" }], error: null }).then(resolve);
          }
          if (options.currentContext && (table === "official_patch_claimed_fixes" || table === "issue_clusters")) {
            const sourceRows = table === "official_patch_claimed_fixes"
              ? [{ id: "fix-1", fix_text: "Fixed a crash." }]
              : [{ id: "00000000-0000-4000-8000-000000000001", is_public: true, admin_override: false }];
            const page = sourceRows.filter((row) => String(row.id) > (after ?? ""));
            return Promise.resolve({ data: page, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, cursors };
}

describe("claim review identity", () => {
  it("uses NFC, trims, and collapses whitespace without case-folding", () => {
    expect(normalizeClaimReviewText("  Fixe\u0301d\u00a0\n\tCrash  ")).toBe("Fixéd Crash");
    expect(normalizeClaimReviewText("Fixed Crash")).not.toBe(normalizeClaimReviewText("fixed crash"));
  });

  it("keys an exact patch and normalized line, not its displayed position", () => {
    expect(claimReviewKey("1.14.00", " Fixed\n a crash ")).toBe(claimReviewKey("1.14.00", "Fixed a crash"));
    expect(claimReviewKey("1.14.00", "Fixed a crash")).not.toBe(claimReviewKey("1.14.01", "Fixed a crash"));
  });

  it("normalizes the Unicode whitespace set used by the database key", () => {
    expect(normalizeClaimReviewText(`\u1680Fix\u202Fcrash\uFEFF`)).toBe("Fix crash");
  });
});

describe("claim review queue paging", () => {
  it("walks every id after a short hosted page instead of treating it as the last page", async () => {
    const rows = Array.from({ length: 620 }, (_, index) => pairingRow(String(index + 1).padStart(4, "0")));
    const { client, cursors } = pagingClient(rows, { cap: 137 });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toEqual({ status: "available" });
    expect(queue.history).toHaveLength(620);
    expect(cursors).toEqual([null, "0137", "0274", "0411", "0548", "0620"]);
  });

  it("surfaces a null page as an unavailable read instead of a zero queue", async () => {
    const { client } = pagingClient([], { nullPairingRead: true });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toMatchObject({ status: "unavailable", reason: "error" });
    expect(queue.pendingCount).toBe(0);
    expect(queue.availability.status === "unavailable" && queue.availability.message).toContain("no data");
  });

  it("keeps a stored pending row in read-only history when no current patch can validate it", async () => {
    const row = pairingRow("0001");
    row.state = "pending";
    const { client } = pagingClient([row]);

    const queue = await readClaimReviewQueue(client);

    expect(queue.pendingCount).toBe(0);
    expect(queue.history).toHaveLength(1);
    expect(queue.history[0]?.derivedHistoryReason).toContain("No current official patch");
  });

  it("marks a confirmed old-patch row as read-only history", async () => {
    const row = pairingRow("0001");
    row.patch_version = "1.13.00";
    const { client } = pagingClient([row], { currentContext: true });

    const queue = await readClaimReviewQueue(client);

    expect(queue.history[0]?.derivedHistoryReason).toContain("no longer on the current official patch");
  });

  it("keeps a current confirmed row eligible for its safe undo", async () => {
    const row = pairingRow("0001");
    row.claim_key = claimReviewKey("1.14.00", "Fixed a crash.");
    const { client } = pagingClient([row], { currentContext: true });

    const queue = await readClaimReviewQueue(client);

    expect(queue.history[0]?.derivedHistoryReason).toBeNull();
    expect(queue.history[0]?.isActive).toBe(false);
  });

  it("fails closed when the current-patch validation read is null", async () => {
    const { client } = pagingClient([], { nullCurrentPatchRead: true });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toMatchObject({ status: "unavailable", reason: "error" });
  });
});

describe("claim review durable-sync fallback", () => {
  const legacyRows: Row[] = [
    { id: "00000000-0000-4000-8000-0000000000a1", slug: "legacy-one", title: "Legacy one", lifecycle_reason: "Needs review: keyword match." },
    { id: "00000000-0000-4000-8000-0000000000a2", slug: "legacy-two", title: "Legacy two", lifecycle_reason: "Needs review: unsure match." },
  ];

  it("keeps pre-migration rows visible until the first durable sync is recorded", async () => {
    const { client } = pagingClient([], { syncState: "awaiting", legacyRows });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toMatchObject({ status: "unavailable", reason: "awaiting_sync" });
    expect(queue.pendingCount).toBe(2);
    expect(queue.legacyReadonly).toHaveLength(2);
    expect(queue.pending).toHaveLength(0);
  });

  it("still reports an unapplied migration as missing schema with its legacy rows", async () => {
    const { client } = pagingClient([], { syncState: "missing", legacyRows });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toMatchObject({ status: "unavailable", reason: "missing_schema" });
    expect(queue.pendingCount).toBe(2);
  });

  it("surfaces a denied sync-state read as an error instead of a missing table", async () => {
    const { client } = pagingClient([], { syncState: "denied", legacyRows });

    const queue = await readClaimReviewQueue(client);

    expect(queue.availability).toMatchObject({ status: "unavailable", reason: "error" });
    expect(queue.availability.status === "unavailable" && queue.availability.message).toContain("permission denied");
    expect(queue.pendingCount).toBe(0);
    expect(queue.legacyReadonly).toHaveLength(0);
  });
});

describe("claim review RPC response validation", () => {
  it("does not convert a null mutation response into success", async () => {
    const client = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;

    await expect(applyClaimReviewDecision(client, { pairingId: "00000000-0000-4000-8000-000000000001", revision: 1, action: "confirm", actor: "test" }))
      .resolves.toMatchObject({ status: "error" });
  });

  it("rejects a null proposal response instead of treating it as no decisions", async () => {
    const client = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;

    await expect(recordClaimReviewProposals(client, { proposals: [], now: new Date("2026-09-07T12:00:00Z") }))
      .rejects.toThrow("malformed decisions");
  });
});
