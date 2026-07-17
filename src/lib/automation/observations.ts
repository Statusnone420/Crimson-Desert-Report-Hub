import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { domainTier } from "@/lib/automation/domains";
import type { ObservationKind } from "@/lib/automation/relevance";

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
 * Normalizing digits out of the title collapses the series to one fingerprint;
 * re-observations then increment seen_count — which IS the momentum tracker.
 */
export function normalizeAskSeriesTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*:\s*r\/\w+\s*$/i, "")
    .replace(/\d+/g, "#")
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

/** Gate for the reroute in prepareSignals: trusted domain, has a genre, under the run cap. */
export function shouldCollectObservation(
  candidate: { sourceDomain: string | null; observationKind?: ObservationKind },
  collectedThisRun: number,
): candidate is { sourceDomain: string | null; observationKind: ObservationKind } {
  if (!candidate.observationKind) return false;
  if (collectedThisRun >= MAX_OBSERVATIONS_PER_RUN) return false;
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
  if (!shouldCollectObservation({ sourceDomain: candidate.sourceDomain, observationKind: candidate.kind }, observations.length)) {
    return false;
  }
  seenConflictHashes.add(conflictHash);
  observations.push(candidate);
  return true;
}

type ObservationClient = Pick<SupabaseClient, "from">;

/**
 * Best-effort persistence: the observation lane must never fail a scan run or
 * block signal persistence. Errors are reported into the run ledger only.
 * Missing table (migration not applied yet) degrades to a no-op with a note.
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
    const hashes = [...byHash.keys()];

    const { data: existingRows, error: existingError } = await supabase
      .from("patch_observations")
      .select("id, url_hash, patch_version, seen_count")
      .in("url_hash", hashes)
      .eq("patch_version", patchVersion);
    if (existingError) {
      report.errors.push(`observation read failed: ${existingError.message}`);
      return;
    }
    const existing = new Map(
      (
        (existingRows ?? []) as {
          id: string;
          url_hash: string;
          patch_version: string;
          seen_count: number;
        }[]
      ).map((row) => [row.url_hash, row]),
    );

    // Re-observations: bump seen_count (the momentum tracker) and point the row
    // at the latest post in the series so "Day 21" replaces "Day 20".
    for (const [hash, observation] of byHash) {
      const existingRow = existing.get(hash);
      if (existingRow === undefined) continue;
      const { error: updateError } = await supabase
        .from("patch_observations")
        .update({
          seen_count: existingRow.seen_count + 1,
          observed_at: observation.observedAt,
          last_seen_at: observation.observedAt,
          title: observation.title.slice(0, 240),
          url: observation.url,
          snippet: observation.snippet.slice(0, 500),
        })
        .eq("id", existingRow.id);
      if (updateError) report.errors.push(`observation update failed: ${updateError.message}`);
    }

    const fresh = [...byHash.entries()].filter(([hash]) => !existing.has(hash));
    if (fresh.length === 0) return;

    const { count, error: countError } = await supabase
      .from("patch_observations")
      .select("id", { count: "exact", head: true })
      .eq("patch_version", patchVersion);
    if (countError) {
      report.errors.push(`observation count read failed: ${countError.message}`);
      return;
    }
    const room = Math.max(0, MAX_OBSERVATIONS_PER_PATCH - (count ?? 0));
    if (room === 0) return;

    const rows = fresh.slice(0, room).map(([hash, observation]) => ({
      patch_version: patchVersion,
      kind: observation.kind,
      title: observation.title.slice(0, 240),
      url: observation.url,
      url_hash: hash,
      source_domain: observation.sourceDomain,
      snippet: observation.snippet.slice(0, 500),
      source_published_at: observation.sourcePublishedAt,
      observed_at: observation.observedAt,
    }));
    const { error } = await supabase
      .from("patch_observations")
      .upsert(rows, { onConflict: "url_hash,patch_version", ignoreDuplicates: true });
    if (error) {
      report.errors.push(`observation insert failed: ${error.message}`);
      return;
    }
    report.observationsKept += rows.length;
  } catch (error) {
    report.errors.push(
      `observation persistence failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
