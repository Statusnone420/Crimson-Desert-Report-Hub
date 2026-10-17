import "server-only";
import { createHash } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase";
import { claimMappingRequestBody, type ClaimMappingClaim, type ClaimMappingCluster, type ClaimMappingDecision, type ClaimMappingOptions } from "./claimMapping";
import type { CurrentPatchContext } from "./eligibility";
import { isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";
import { ScannerOperationError } from "./diagnostics";

type Client = ReturnType<typeof createServiceClient>;
export function mappingFingerprint(claim: ClaimMappingClaim, clusters: ClaimMappingCluster[], patch: CurrentPatchContext, options: ClaimMappingOptions): string {
  return createHash("sha256").update(JSON.stringify({ version: 1, patch: { version: patch.version, publishedAt: patch.publishedAt },
    claim: { fixText: claim.fixText, category: claim.category },
    // IDs participate because provider slugs must resolve to this eligible set.
    clusters: clusters.map(({ id, slug, title, category, description }) => ({ id, slug, title, category, description })),
    ...(options.configuredModel ? { configuredModel: options.configuredModel } : {}),
    request: claimMappingRequestBody(claim, clusters, options.modelPreset, options.env, options.configuredModel) })).digest("hex");
}

function cachedDecision(value: unknown, clusters: ClaimMappingCluster[], claim: ClaimMappingClaim): ClaimMappingDecision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.matchKind !== "llm_sure" && row.matchKind !== "llm_unsure") return null;
  if (typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 180) return null;
  const cluster = clusters.find((entry) => entry.id === row.clusterId && entry.slug === row.clusterSlug);
  if (row.clusterId !== null && !cluster) return null;
  if (row.matchKind === "llm_sure" && (!cluster || claim.category !== null && cluster.category !== claim.category)) return null;
  return { matchKind: row.matchKind, clusterId: cluster?.id ?? null, clusterSlug: cluster?.slug ?? null,
    reason: row.reason, extractionModel: null, llmCallsUsed: 0, llmCostUsd: 0 };
}

/** Cached proposals still pass through the durable admin decision resolver. */
export async function reuseClaimMapping(client: Client, claim: ClaimMappingClaim, clusters: ClaimMappingCluster[], patch: CurrentPatchContext,
  options: ClaimMappingOptions, map: () => Promise<ClaimMappingDecision>, now: Date,
  onWarning?: (error: unknown) => void): Promise<ClaimMappingDecision> {
  let fingerprint: string;
  try { fingerprint = mappingFingerprint(claim, clusters, patch, options); }
  catch { return map(); }
  const { data, error } = await client.from("scanner_mapping_cache").select("decision")
    .eq("fingerprint", fingerprint).gt("expires_at", now.toISOString()).limit(1);
  if (error && !isMissingSupabaseRelation(error, "scanner_mapping_cache")) throw new ScannerOperationError("mapping_cache_read", error);
  if (!error) {
    const cached = cachedDecision((data as { decision: unknown }[] | null)?.[0]?.decision, clusters, claim);
    if (cached) return cached;
  }
  const decision = await map();
  if (!error && !decision.skipReason && decision.llmCallsUsed > 0 && ["llm_sure", "llm_unsure"].includes(decision.matchKind)) {
    const { error: saveError } = await client.from("scanner_mapping_cache").upsert({ fingerprint,
      decision: { matchKind: decision.matchKind, clusterId: decision.clusterId, clusterSlug: decision.clusterSlug, reason: decision.reason },
      expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString() });
    // A cache failure must be visible, but must not discard a validated paid
    // decision or bypass the durable review resolver that follows this call.
    if (saveError) {
      if (!onWarning) throw new ScannerOperationError("mapping_cache", saveError);
      onWarning(saveError);
    }
  }
  return decision;
}
