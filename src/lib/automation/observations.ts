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

/** Gate for the reroute in prepareSignals: trusted domain, has a genre, under the run cap. */
export function shouldCollectObservation(
  candidate: { sourceDomain: string | null; observationKind?: ObservationKind },
  collectedThisRun: number,
): candidate is { sourceDomain: string | null; observationKind: ObservationKind } {
  if (!candidate.observationKind) return false;
  if (collectedThisRun >= MAX_OBSERVATIONS_PER_RUN) return false;
  return domainTier(candidate.sourceDomain) === "trusted";
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

    const rows = observations.slice(0, room).map((observation) => ({
      patch_version: patchVersion,
      kind: observation.kind,
      title: observation.title.slice(0, 240),
      url: observation.url,
      url_hash: observationUrlHash(observation.url),
      source_domain: observation.sourceDomain,
      snippet: observation.snippet.slice(0, 500),
      source_published_at: observation.sourcePublishedAt,
      observed_at: observation.observedAt,
    }));
    const { error } = await supabase
      .from("patch_observations")
      .upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true });
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
