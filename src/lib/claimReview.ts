import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSupabaseRelation, isMissingSupabaseRpc, type SupabaseErrorLike } from "@/lib/supabaseCompatibility";
import { createServiceClient } from "@/lib/supabase";

export type ClaimReviewState = "pending" | "later" | "confirmed" | "rejected" | "retired";
export type ClaimReviewProposalKind = "llm_sure" | "llm_unsure" | "keyword_proposal";
export type ClaimReviewAction = "confirm" | "reject" | "later" | "undo";

export type ClaimReviewItem = {
  id: string;
  pairingKey: string;
  claimKey: string;
  revision: number;
  state: ClaimReviewState;
  boardNo: string;
  patchVersion: string;
  officialUrl: string;
  exactOfficialText: string;
  officialSection: string | null;
  clusterId: string;
  clusterSlug: string;
  clusterTitle: string;
  clusterCategory: string;
  proposalKind: ClaimReviewProposalKind;
  proposalReason: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  seenByOperatorAt: string | null;
  rejectedReason: string | null;
  confirmedAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  clusterLifecycleRevision: number;
  isActive: boolean;
  derivedHistoryReason: string | null;
};

export type ClaimReviewAuditEvent = {
  id: string;
  pairingId: string;
  action: string;
  actor: string;
  occurredAt: string;
  priorState: ClaimReviewState | null;
  state: ClaimReviewState;
  exactOfficialText: string;
  patchVersion: string;
  reason: string | null;
};

export type ClaimReviewAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: "missing_schema" | "error"; message: string };

export type ClaimReviewQueue = {
  availability: ClaimReviewAvailability;
  pending: ClaimReviewItem[];
  history: ClaimReviewItem[];
  audit: ClaimReviewAuditEvent[];
  pendingCount: number;
  legacyReadonly: ClaimReviewItem[];
};

export type ClaimReviewMutation = {
  pairingId: string;
  revision: number;
  action: ClaimReviewAction;
  reason?: string | null;
  actor: string;
};

export type ClaimReviewMutationResult =
  | { status: "success"; item: ClaimReviewItem }
  | { status: "unavailable"; message: string }
  | { status: "stale"; message: string }
  | { status: "validation_error"; message: string }
  | { status: "error"; message: string };

export type ClaimReviewProposal = {
  fixText: string;
  clusterId: string;
  proposalKind: ClaimReviewProposalKind;
  proposalReason: string;
};

export type ClaimReviewLifecycleDecision = {
  clusterId: string;
  state: ClaimReviewState;
  proposalKind: ClaimReviewProposalKind;
  reason: string;
};

export function normalizeClaimReviewText(value: string): string {
  return value.normalize("NFC").replace(/\0/g, "").trim().replace(/\s+/gu, " ");
}

export function claimReviewKey(patchVersion: string, exactFixText: string): string {
  return createHash("sha256").update(`${patchVersion}\n${normalizeClaimReviewText(exactFixText)}`).digest("hex");
}

function toItem(row: Record<string, unknown>): ClaimReviewItem {
  return {
    id: String(row.id), pairingKey: String(row.pairing_key), claimKey: String(row.claim_key), revision: Number(row.revision),
    state: row.state as ClaimReviewState, boardNo: String(row.board_no), patchVersion: String(row.patch_version), officialUrl: String(row.official_url),
    exactOfficialText: String(row.exact_official_text), officialSection: row.official_section as string | null,
    clusterId: String(row.cluster_id), clusterSlug: String(row.cluster_slug), clusterTitle: String(row.cluster_title), clusterCategory: String(row.cluster_category),
    proposalKind: row.proposal_kind as ClaimReviewProposalKind, proposalReason: String(row.proposal_reason),
    firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at), seenCount: Number(row.seen_count),
    seenByOperatorAt: row.seen_by_operator_at as string | null, rejectedReason: row.rejected_reason as string | null,
    confirmedAt: row.confirmed_at as string | null, retiredAt: row.retired_at as string | null,
    retiredReason: row.retired_reason as string | null, clusterLifecycleRevision: Number(row.cluster_lifecycle_revision),
    isActive: false, derivedHistoryReason: null,
  };
}

function toAudit(row: Record<string, unknown>): ClaimReviewAuditEvent {
  return {
    id: String(row.id), pairingId: String(row.pairing_id), action: String(row.action), actor: String(row.actor),
    occurredAt: String(row.occurred_at), priorState: row.prior_state as ClaimReviewState | null, state: row.state as ClaimReviewState,
    exactOfficialText: String(row.exact_official_text), patchVersion: String(row.patch_version), reason: row.reason as string | null,
  };
}

async function readAll<T extends Record<string, unknown>>(
  query: (after: string | null) => PromiseLike<{ data: T[] | null; error: SupabaseErrorLike | null }>,
): Promise<{ rows: T[] } | { error: SupabaseErrorLike }> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await query(after);
    if (error) return { error };
    if (data === null) return { error: { message: "claim review page returned no data" } };
    const page = data;
    rows.push(...page);
    if (page.length === 0) return { rows };
    const lastId = page.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId) return { error: { message: "claim review page is missing its stable id" } };
    after = lastId;
  }
}

async function readLegacyReadonly(client: SupabaseClient): Promise<ClaimReviewItem[] | { error: SupabaseErrorLike }> {
  const result = await readAll<Record<string, unknown>>((after) => {
    const query = client.from("issue_clusters").select("id, slug, title, lifecycle_reason").eq("admin_override", false)
      .like("lifecycle_reason", "Needs review:%").order("id").limit(500);
    return after === null ? query : query.gt("id", after);
  },
  );
  if ("error" in result) return result;
  return result.rows.map((row) => ({
    id: `legacy:${String(row.id)}`, pairingKey: "", claimKey: "", revision: 0, state: "pending",
    boardNo: "", patchVersion: "", officialUrl: "", exactOfficialText: "Official claim mapping is unavailable until the claim-review migration is applied.",
    officialSection: null, clusterId: String(row.id), clusterSlug: String(row.slug ?? ""), clusterTitle: String(row.title ?? "Issue"), clusterCategory: "",
    proposalKind: "llm_unsure", proposalReason: String(row.lifecycle_reason ?? "Needs review"), firstSeenAt: "", lastSeenAt: "", seenCount: 0,
    seenByOperatorAt: null, rejectedReason: null, confirmedAt: null, retiredAt: null, retiredReason: null, clusterLifecycleRevision: 0,
    isActive: false, derivedHistoryReason: null,
  }));
}

type ClaimReviewCurrentContext = {
  boardNo: string;
  patchVersion: string;
  claimKeys: Set<string>;
  reviewableClusters: Set<string>;
};

async function readClaimReviewCurrentContext(
  client: SupabaseClient,
): Promise<{ context: ClaimReviewCurrentContext | null } | { error: SupabaseErrorLike }> {
  const current = await client.from("official_patch_notes").select("board_no, patch_version").eq("is_current", true).limit(1);
  if (current.error) return { error: current.error };
  if (current.data === null) return { error: { message: "claim review current patch read returned no data" } };
  const row = (current.data as { board_no?: unknown; patch_version?: unknown }[])[0];
  if (!row) return { context: null };
  if (typeof row.board_no !== "string" || typeof row.patch_version !== "string") {
    return { error: { message: "claim review current patch row is malformed" } };
  }
  const fixes = await readAll<Record<string, unknown>>((after) => {
    const query = client.from("official_patch_claimed_fixes").select("id, fix_text").eq("board_no", row.board_no).order("id").limit(500);
    return after === null ? query : query.gt("id", after);
  });
  if ("error" in fixes) return fixes;
  const clusters = await readAll<Record<string, unknown>>((after) => {
    const query = client.from("issue_clusters").select("id, is_public, admin_override").order("id").limit(500);
    return after === null ? query : query.gt("id", after);
  });
  if ("error" in clusters) return clusters;
  const claimKeys = new Set<string>();
  for (const fix of fixes.rows) {
    if (typeof fix.fix_text !== "string") return { error: { message: "claim review official claim row is malformed" } };
    claimKeys.add(claimReviewKey(row.patch_version, fix.fix_text));
  }
  const reviewableClusters = new Set<string>();
  for (const cluster of clusters.rows) {
    if (typeof cluster.id !== "string" || typeof cluster.is_public !== "boolean" || typeof cluster.admin_override !== "boolean") {
      return { error: { message: "claim review cluster row is malformed" } };
    }
    if (cluster.is_public && !cluster.admin_override) reviewableClusters.add(cluster.id);
  }
  return { context: { boardNo: row.board_no, patchVersion: row.patch_version, claimKeys, reviewableClusters } };
}

function projectActivePairing(item: ClaimReviewItem, context: ClaimReviewCurrentContext | null): ClaimReviewItem {
  if (item.state === "retired") return item;
  if (context === null) return { ...item, derivedHistoryReason: "No current official patch is available." };
  if (item.boardNo !== context.boardNo || item.patchVersion !== context.patchVersion) {
    return { ...item, derivedHistoryReason: "This pairing is no longer on the current official patch." };
  }
  if (!context.claimKeys.has(item.claimKey)) {
    return { ...item, derivedHistoryReason: "This exact official claim is no longer current." };
  }
  if (!context.reviewableClusters.has(item.clusterId)) {
    return { ...item, derivedHistoryReason: "This issue is no longer public and unlocked for review." };
  }
  return { ...item, isActive: item.state === "pending" || item.state === "later" };
}

export async function readClaimReviewQueue(client: SupabaseClient = createServiceClient()): Promise<ClaimReviewQueue> {
  const pairings = await readAll<Record<string, unknown>>((after) => {
    const query = client.from("claim_review_pairings").select("*").order("id").limit(500);
    return after === null ? query : query.gt("id", after);
  },
  );
  if ("error" in pairings) {
    if (isMissingSupabaseRelation(pairings.error, "claim_review_pairings")) {
      const legacy = await readLegacyReadonly(client);
      if ("error" in legacy) {
        return { availability: { status: "unavailable", reason: "error", message: `claim review legacy read failed: ${legacy.error.message ?? "unknown error"}` }, pending: [], history: [], audit: [], pendingCount: 0, legacyReadonly: [] };
      }
      return { availability: { status: "unavailable", reason: "missing_schema", message: "Claim review is unavailable until its migration is applied." }, pending: [], history: [], audit: [], pendingCount: legacy.length, legacyReadonly: legacy };
    }
    return { availability: { status: "unavailable", reason: "error", message: `claim review read failed: ${pairings.error.message ?? "unknown error"}` }, pending: [], history: [], audit: [], pendingCount: 0, legacyReadonly: [] };
  }
  const currentContext = await readClaimReviewCurrentContext(client);
  if ("error" in currentContext) {
    return { availability: { status: "unavailable", reason: "error", message: `claim review eligibility read failed: ${currentContext.error.message ?? "unknown error"}` }, pending: [], history: [], audit: [], pendingCount: 0, legacyReadonly: [] };
  }
  const audits = await readAll<Record<string, unknown>>((after) => {
    const query = client.from("claim_review_audit_events").select("*").order("id").limit(500);
    return after === null ? query : query.gt("id", after);
  },
  );
  if ("error" in audits) {
    return { availability: { status: "unavailable", reason: "error", message: `claim review audit read failed: ${audits.error.message ?? "unknown error"}` }, pending: [], history: [], audit: [], pendingCount: 0, legacyReadonly: [] };
  }
  const items = pairings.rows.map(toItem).map((item) => projectActivePairing(item, currentContext.context));
  const pending = items.filter((item) => item.isActive);
  return { availability: { status: "available" }, pending, history: items.filter((item) => !item.isActive), audit: audits.rows.map(toAudit), pendingCount: pending.length, legacyReadonly: [] };
}

function rpcMessage(error: SupabaseErrorLike): ClaimReviewMutationResult {
  const message = error.message ?? "Claim review write failed.";
  if (/stale_|claim_review_(?:pairing|patch|cluster)_stale|locked/i.test(message)) return { status: "stale", message };
  if (/invalid_|required|reason/i.test(message)) return { status: "validation_error", message };
  return { status: "error", message };
}

export async function applyClaimReviewDecision(
  client: SupabaseClient,
  input: ClaimReviewMutation,
): Promise<ClaimReviewMutationResult> {
  const { data, error } = await client.rpc("mutate_claim_review_pairing", {
    p_pairing_id: input.pairingId, p_revision: input.revision, p_action: input.action,
    p_reason: input.reason ?? null, p_actor: input.actor,
  });
  if (error) {
    if (isMissingSupabaseRpc(error, "mutate_claim_review_pairing")) return { status: "unavailable", message: "Claim review is unavailable until its migration is applied." };
    return rpcMessage(error);
  }
  if (!data || Array.isArray(data) || typeof data !== "object") return { status: "error", message: "Claim review write returned no pairing." };
  return { status: "success", item: toItem(data as Record<string, unknown>) };
}

export async function recordClaimReviewProposals(
  client: SupabaseClient,
  input: { proposals: ClaimReviewProposal[]; now: Date },
): Promise<{ status: "available"; decisions: ClaimReviewLifecycleDecision[] } | { status: "unavailable" }> {
  const { data, error } = await client.rpc("sync_claim_review_proposals", {
    p_proposals: input.proposals.map((proposal) => ({
      claim_text: proposal.fixText, cluster_id: proposal.clusterId, proposal_kind: proposal.proposalKind, proposal_reason: proposal.proposalReason,
    })),
    p_seen_at: input.now.toISOString(),
  });
  if (error) {
    if (isMissingSupabaseRpc(error, "sync_claim_review_proposals")) return { status: "unavailable" };
    throw new Error(`claim review proposal sync failed: ${error.message ?? "unknown error"}`);
  }
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || typeof (row as Record<string, unknown>).cluster_id !== "string" || typeof (row as Record<string, unknown>).state !== "string" || typeof (row as Record<string, unknown>).proposal_kind !== "string" || typeof (row as Record<string, unknown>).proposal_reason !== "string")) {
    throw new Error("claim review proposal sync returned malformed decisions");
  }
  return { status: "available", decisions: (data as Record<string, unknown>[]).map((row) => ({
    clusterId: row.cluster_id as string, state: row.state as ClaimReviewState, proposalKind: row.proposal_kind as ClaimReviewProposalKind, reason: row.proposal_reason as string,
  })) };
}
