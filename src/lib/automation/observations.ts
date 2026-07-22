import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { domainTier } from "@/lib/automation/domains";
import { hasCrimsonDesertContext, type ObservationKind } from "@/lib/automation/relevance";

/**
 * Observation lane: the typed shelf for patch-day context the evidence funnel
 * rejects on purpose (press reception, patch release coverage, fix talk).
 *
 * Safety posture — observations publish WITHOUT corroboration, so every lever
 * here limits blast radius instead:
 *   - allowlist: only domains already in the scanner's single TRUSTED_DOMAINS
 *     set are ever stored (no second, parallel trust list);
 *   - caps: at most MAX_OBSERVATIONS_PER_RUN per run and
 *     MAX_OBSERVATIONS_PER_PATCH per patch version;
 *   - no editorializing: title/snippet stored verbatim, displayed as-is;
 *   - hard separation: no cluster_id, no counts — an observation can never
 *     leak into evidence numbers.
 */

export const MAX_OBSERVATIONS_PER_RUN = 5;
export const MAX_OBSERVATIONS_PER_PATCH = 40;

export type ObservationCandidate = {
  kind: ObservationKind;
  title: string;
  url: string;
  sourceDomain: string | null;
  snippet: string;
  sourcePublishedAt: string | null;
  observedAt: string;
};

export function observationUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/**
 * Serialized campaigns post a NEW thread each day ("Day 20 of asking…", "Day 21
 * of asking…"), so URL identity would fragment one campaign into daily rows.
 * Normalizing only the serialized day number collapses the series to one
 * fingerprint while preserving meaningful numbers in the request itself;
 * re-observations then increment seen_count — which IS the momentum tracker.
 */
export function normalizeAskSeriesTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*:\s*r\/\w+\s*$/i, "")
    .replace(/\bday\s+\d+\b/g, "day #")
    .replace(/\s+/g, " ")
    .trim();
}

export function observationConflictHash(candidate: Pick<ObservationCandidate, "kind" | "title" | "url" | "sourceDomain">): string {
  if (candidate.kind === "community_ask") {
    return createHash("sha256")
      .update(`ask:${candidate.sourceDomain ?? ""}:${normalizeAskSeriesTitle(candidate.title)}`)
      .digest("hex");
  }
  return observationUrlHash(candidate.url);
}

/** Gate for the reroute in prepareSignals: relevant topic, reputable source, named genre, and room under the cap. */
export function shouldCollectObservation(
  candidate: {
    title: string;
    snippet: string;
    url: string;
    sourceDomain: string | null;
    observationKind?: ObservationKind;
  },
  collectedThisRun: number,
): candidate is typeof candidate & { observationKind: ObservationKind } {
  if (!candidate.observationKind) return false;
  if (collectedThisRun >= MAX_OBSERVATIONS_PER_RUN) return false;
  if (!hasCrimsonDesertContext(candidate)) return false;
  return domainTier(candidate.sourceDomain) === "trusted";
}

/** Deduplicate by campaign/source identity before applying the per-run cap. */
export function appendUniqueObservation(
  observations: ObservationCandidate[],
  candidate: ObservationCandidate,
  seenConflictHashes: Set<string>,
): boolean {
  const conflictHash = observationConflictHash(candidate);
  if (seenConflictHashes.has(conflictHash)) return false;
  if (!shouldCollectObservation({
    title: candidate.title,
    snippet: candidate.snippet,
    url: candidate.url,
    sourceDomain: candidate.sourceDomain,
    observationKind: candidate.kind,
  }, observations.length)) {
    return false;
  }
  seenConflictHashes.add(conflictHash);
  observations.push(candidate);
  return true;
}

type ObservationClient = Pick<SupabaseClient, "rpc">;

/**
 * Best-effort persistence: the observation lane must never fail a scan run or
 * block signal persistence. Errors are reported into the run ledger only.
 * The database RPC owns the patch cap and serializes overlapping writers.
 * Missing table/function (migration not applied yet) degrades to a no-op with
 * a note.
 */
export async function persistObservations(
  supabase: ObservationClient,
  observations: ObservationCandidate[],
  patchVersion: string,
  report: { errors: string[]; observationsKept: number },
): Promise<void> {
  if (observations.length === 0) return;
  try {
    const byHash = new Map<string, ObservationCandidate>();
    for (const observation of observations) {
      const hash = observationConflictHash(observation);
      if (!byHash.has(hash)) byHash.set(hash, observation);
    }
    const rows = [...byHash.entries()].map(([hash, observation]) => ({
      kind: observation.kind,
      title: observation.title.slice(0, 240),
      url: observation.url,
      url_hash: hash,
      source_domain: observation.sourceDomain,
      snippet: observation.snippet.slice(0, 500),
      source_published_at: observation.sourcePublishedAt,
      observed_at: observation.observedAt,
    }));

    const { data, error } = await supabase.rpc("persist_patch_observations", {
      p_patch_version: patchVersion,
      p_observations: rows,
    });
    if (error) {
      report.errors.push(`observation persistence failed: ${error.message}`);
      return;
    }
    report.observationsKept += Number(data ?? 0);
  } catch (error) {
    report.errors.push(
      `observation persistence failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
