import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { claimReviewKey, normalizeClaimReviewText } from "@/lib/claimReview";
import type { CurrentPatchMetadata } from "@/lib/officialPatch.server";
import type { SupabaseErrorLike } from "@/lib/supabaseCompatibility";

export type PublicIssueClaim = {
  key: string;
  text: string;
  section: string | null;
  officialUrl: string;
};

export type PublicClaimCluster = {
  id: string;
  is_public: boolean;
  admin_override: boolean;
  fix_claimed_at: string | null;
  fix_claimed_patch_version: string | null;
};

type PublicClaimContext = {
  byCluster: Record<string, PublicIssueClaim[]>;
  unavailable: boolean;
};

type Row = Record<string, unknown>;
type ReadResponse = { data: Row[] | null; error: SupabaseErrorLike | null };

const PAGE_SIZE = 500;

function unavailable(): PublicClaimContext {
  return { byCluster: {}, unavailable: true };
}

async function readAll(
  query: (after: string | null) => PromiseLike<ReadResponse>,
): Promise<Row[] | null> {
  const rows: Row[] = [];
  let after: string | null = null;

  for (;;) {
    const { data, error } = await query(after);
    if (error || data === null) return null;
    rows.push(...data);
    if (data.length === 0) return rows;

    const lastId = data.at(-1)?.id;
    if (typeof lastId !== "string" || !lastId || lastId === after) return null;
    after = lastId;
  }
}

function isCurrentBoard(row: Row, currentPatch: Pick<CurrentPatchMetadata, "version" | "officialUrl">): row is {
  board_no: string;
  patch_version: string;
  official_url: string;
} {
  return (
    typeof row.board_no === "string" && row.board_no.length > 0 &&
    typeof row.patch_version === "string" && row.patch_version === currentPatch.version &&
    typeof row.official_url === "string" && row.official_url === currentPatch.officialUrl
  );
}

function isEligibleCluster(
  cluster: PublicClaimCluster,
  patchVersion: string,
): boolean {
  return (
    typeof cluster.id === "string" && cluster.id.length > 0 &&
    cluster.is_public === true &&
    cluster.admin_override === false &&
    typeof cluster.fix_claimed_at === "string" && cluster.fix_claimed_at.length > 0 &&
    cluster.fix_claimed_patch_version === patchVersion
  );
}

/**
 * Returns only current, confirmed official claims. It deliberately derives
 * visible claim text from the current official source rather than from the
 * private pairing snapshot.
 */
export async function readPublicClaimContext(
  supabase: SupabaseClient,
  currentPatch: Pick<CurrentPatchMetadata, "version" | "officialUrl">,
  publicClusters: readonly PublicClaimCluster[],
): Promise<PublicClaimContext> {
  try {
    const eligibleClusterIds = new Set(
      publicClusters.filter((cluster) => isEligibleCluster(cluster, currentPatch.version)).map((cluster) => cluster.id),
    );
    if (eligibleClusterIds.size === 0) return { byCluster: {}, unavailable: false };

    const boardResponse = await supabase
      .from("official_patch_notes")
      .select("board_no, patch_version, official_url")
      .eq("is_current", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(2);
    if (boardResponse.error || boardResponse.data === null || boardResponse.data.length !== 1) return unavailable();

    const board = boardResponse.data[0] as Row;
    if (!isCurrentBoard(board, currentPatch)) return unavailable();

    const fixes = await readAll((after) => {
      const query = supabase
        .from("official_patch_claimed_fixes")
        .select("id, board_no, fix_text, section")
        .eq("board_no", board.board_no)
        .order("id")
        .limit(PAGE_SIZE);
      return (after === null ? query : query.gt("id", after)) as PromiseLike<ReadResponse>;
    });
    if (fixes === null) return unavailable();

    const officialClaims = new Map<string, PublicIssueClaim>();
    for (const fix of fixes) {
      if (
        typeof fix.id !== "string" || !fix.id ||
        fix.board_no !== board.board_no ||
        typeof fix.fix_text !== "string" || !normalizeClaimReviewText(fix.fix_text) ||
        (fix.section !== null && typeof fix.section !== "string")
      ) return unavailable();
      const key = claimReviewKey(board.patch_version, fix.fix_text);
      if (!officialClaims.has(key)) {
        officialClaims.set(key, {
          key,
          text: fix.fix_text,
          section: fix.section as string | null,
          officialUrl: board.official_url,
        });
      }
    }

    const pairings = await readAll((after) => {
      const query = supabase
        .from("claim_review_pairings")
        .select("id, cluster_id, claim_key, state, board_no, patch_version, official_url, exact_official_text")
        .eq("state", "confirmed")
        .eq("board_no", board.board_no)
        .eq("patch_version", board.patch_version)
        .order("id")
        .limit(PAGE_SIZE);
      return (after === null ? query : query.gt("id", after)) as PromiseLike<ReadResponse>;
    });
    if (pairings === null) return unavailable();

    const claimsByCluster = new Map<string, Map<string, PublicIssueClaim>>();

    for (const pairing of pairings) {
      if (
        typeof pairing.id !== "string" || !pairing.id ||
        typeof pairing.cluster_id !== "string" ||
        typeof pairing.claim_key !== "string" ||
        typeof pairing.exact_official_text !== "string" ||
        typeof pairing.state !== "string" ||
        typeof pairing.board_no !== "string" ||
        typeof pairing.patch_version !== "string" ||
        typeof pairing.official_url !== "string"
      ) return unavailable();

      if (
        pairing.state !== "confirmed" ||
        pairing.board_no !== board.board_no ||
        pairing.patch_version !== board.patch_version ||
        pairing.official_url !== board.official_url
      ) continue;

      const claim = officialClaims.get(pairing.claim_key);
      if (
        !claim ||
        pairing.claim_key !== claimReviewKey(board.patch_version, pairing.exact_official_text) ||
        normalizeClaimReviewText(pairing.exact_official_text) !== normalizeClaimReviewText(claim.text) ||
        !eligibleClusterIds.has(pairing.cluster_id)
      ) continue;

      const clusterClaims = claimsByCluster.get(pairing.cluster_id) ?? new Map<string, PublicIssueClaim>();
      clusterClaims.set(claim.key, claim);
      claimsByCluster.set(pairing.cluster_id, clusterClaims);
    }

    return {
      byCluster: Object.fromEntries(
        [...claimsByCluster].map(([clusterId, claims]) => [clusterId, [...claims.values()]]),
      ),
      unavailable: false,
    };
  } catch {
    return unavailable();
  }
}
