import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { domainTier } from "@/lib/automation/domains";
import { hasCrimsonDesertContext, type ObservationKind } from "@/lib/automation/relevance";
import {
  ASCII_EDGE_BLANKS,
  hasUsableDate,
  isDisplayableDatedObservation,
  patchEraFloorMs,
} from "@/lib/observationDisplay";

/**
 * Observation lane: the typed shelf for patch-day context the evidence funnel
 * rejects on purpose (press reception, patch release coverage, fix talk).
 *
 * Safety posture — observations publish WITHOUT corroboration, so every lever
 * here limits blast radius instead:
 *   - allowlist: only domains already in the scanner's single TRUSTED_DOMAINS
 *     set are ever stored (no second, parallel trust list);
 *   - caps: at most MAX_OBSERVATIONS_PER_RUN per run and
 *     MAX_OBSERVATIONS_PER_PATCH per patch version. The run cap is
 *     dated-priority: a candidate carrying a displayable publication date
 *     displaces the newest undated row when the shelf is full, because the
 *     Brief can only render dated observations and the dated wire results
 *     arrive last in a run;
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

/**
 * Priority additionally requires a date the Brief could actually show:
 * surviving the ::timestamptz cast is not enough, because the display gate
 * also rejects dates more than 48 hours ahead of the clock and dates before
 * the patch era. A timestamp eight days in the future casts fine and renders
 * never — letting it outrank an undated row wastes the swap, and letting it
 * sit on the shelf LOOKING dated blocks the genuinely dated candidate that
 * arrives later. So displacement and payload order both reuse the Brief's own
 * date predicate, judged at the run's observedAt: deterministic (no wall
 * clock in the lane), and monotone-safe, since the Brief re-checks skew with
 * a strictly later clock, a date that clears it here can never fail it there.
 * The era floor applies whenever the caller knows the patch's publish date
 * and is skipped when it does not — matching the display gate, which also
 * skips it for an unknown era. NOTE: omitting patchPublishedAt is a silent
 * weakening, not an error — a caller that forgets to thread it lets pre-era
 * rows regain priority, so pass it wherever the patch is known. The non-date
 * render gates (moderation, kind, relevance) are unchanged and can still
 * hide a prioritized row.
 *
 * Trimmed ONCE, up front, so both halves of the composite judge the
 * identical string: V8's strict ISO parser rejects a trailing blank that the
 * cast forgives, and trimming inside only one half would let the two
 * disagree about the same value.
 */
function hasDisplayableDate(
  observation: Pick<ObservationCandidate, "sourcePublishedAt" | "observedAt">,
  patchPublishedAt: string | null,
): boolean {
  if (!observation.sourcePublishedAt) return false;
  const sourcePublishedAt = observation.sourcePublishedAt.replace(ASCII_EDGE_BLANKS, "");
  if (!hasUsableDate(sourcePublishedAt)) return false;
  const observedAtMs = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  return isDisplayableDatedObservation(
    { source_published_at: sourcePublishedAt },
    patchPublishedAt,
    observedAtMs,
  );
}

/**
 * The persistence contract asks a stricter question than shelf priority: was
 * EVERY display gate — the era floor included — actually enforced on this
 * date? hasDisplayableDate skips the floor when the patch era is unknown,
 * matching the render gate's behavior at that same moment. With a known,
 * parseable era the two predicates are literally the same test — the split
 * can only matter during degraded metadata, where the lenience is harmless
 * for in-memory priority: a pseudo-dated row can only ever displace a row
 * that also cannot render. But a payload date is a different
 * promise. The RPC's marked coalesce REPLACES stored dates with incoming
 * ones, and a date vetted without the floor can be pre-era — a run that read
 * its patch through fallbackCurrentPatchMetadata (metadata read or sync
 * down) would certify it, overwrite a stored good date, and once metadata
 * recovers the Brief applies the real floor and the row goes dark, sticky
 * until an unrelated re-sighting. So certification additionally requires the
 * same finite era floor the Brief will use (patchEraFloorMs is NaN for a
 * null OR unparseable era — one test, no second parser). With the era
 * unknown, every date travels as NULL: stored state stays untouched, and a
 * later certified sighting fills or heals it.
 */
function hasCertifiedDisplayableDate(
  observation: Pick<ObservationCandidate, "sourcePublishedAt" | "observedAt">,
  patchPublishedAt: string | null,
): boolean {
  if (!Number.isFinite(patchEraFloorMs(patchPublishedAt))) return false;
  return hasDisplayableDate(observation, patchPublishedAt);
}

/**
 * A duplicate sighting of a page already on the shelf can still teach us one
 * thing: the page's publication date. General search returns URLs undated;
 * the wire returns some of the SAME URLs dated, later in the run, where
 * first-wins dedup would discard them — date and all. Coalescing just the
 * date onto the incumbent keeps first-wins semantics for content (title,
 * snippet, position, seniority all stay with the first sighting) while
 * letting the run's only dated copy of a page make its twin renderable.
 * Only an incumbent whose date never clears the display gate is upgraded,
 * and only to a date that clears it at the incumbent's own observedAt — a
 * dated row is never overwritten, and junk never sneaks in as an "upgrade".
 */
function coalesceDuplicateDate(
  row: ObservationCandidate,
  sourcePublishedAt: string | null,
  patchPublishedAt: string | null,
): boolean {
  if (!sourcePublishedAt) return false;
  if (hasDisplayableDate(row, patchPublishedAt)) return false;
  if (!hasDisplayableDate({ sourcePublishedAt, observedAt: row.observedAt }, patchPublishedAt)) return false;
  row.sourcePublishedAt = sourcePublishedAt;
  return true;
}

/**
 * The prepareSignals hook: its first-wins URL dedup drops a duplicate signal
 * before the observation reroute ever sees it, so the date has to be offered
 * to the shelf at the drop site. Matches by canonical URL — the same page,
 * whatever lane returned it. Returns whether a row was upgraded.
 */
export function upgradeObservationDate(
  observations: ObservationCandidate[],
  canonicalUrl: string,
  sourcePublishedAt: string | null,
  patchPublishedAt: string | null = null,
): boolean {
  for (const row of observations) {
    if (row.url !== canonicalUrl) continue;
    return coalesceDuplicateDate(row, sourcePublishedAt, patchPublishedAt);
  }
  return false;
}

/**
 * Deduplicate by campaign/source identity before applying the per-run cap.
 *
 * The cap is dated-priority. collectInputs appends the wire results AFTER the
 * general queries, and the wire is the only SEARCH lane whose results carry
 * real publication dates — the thing isBriefEligibleObservation requires.
 * (Reddit intake is dated too, and arrives first; a shelf it fills is already
 * renderable and nothing here displaces it.) A productive general turn could
 * fill all five slots with undated rows a reader never sees, and the dated
 * results the wire credit was spent on were discarded at the door. When the
 * shelf is full, a dated candidate now takes the NEWEST undated row's place —
 * in place, keeping the shelf deterministic for a given input order, while
 * persistObservations separately orders dated rows ahead of the per-patch
 * cap's cutoff. Earlier rows keep first-wins seniority, undated
 * rows still fill the shelf freely when no dated candidate arrives, and total
 * supply never drops. "Dated" here means hasDisplayableDate: a publication
 * date the Brief's date gate would accept, not merely one persistence can
 * parse — see that predicate for why both bounds matter. A displacing row can
 * still be hidden by the non-date gates, but it can only ever take the place
 * of a row whose date never clears. Reordering the inputs instead was
 * rejected because input order also drives recon-fetch precedence, LLM budget
 * consumption, and first-wins URL dedup.
 */
export function appendUniqueObservation(
  observations: ObservationCandidate[],
  candidate: ObservationCandidate,
  seenConflictHashes: Set<string>,
  patchPublishedAt: string | null = null,
): boolean {
  const conflictHash = observationConflictHash(candidate);
  if (seenConflictHashes.has(conflictHash)) {
    // Duplicate identity: never a second SIMULTANEOUS slot, but its date can
    // still upgrade the incumbent (see coalesceDuplicateDate). Only for the
    // SAME page: an ask-series fingerprint deliberately spans different URLs
    // ("Day 20" and "Day 21" share a hash), and donating Day 21's date to
    // Day 20's row would carry a pre-era thread past the patch-era floor —
    // a date must never describe a page it does not belong to. For every
    // other kind hash equality already implies URL equality.
    const incumbent = observations.find((row) => observationConflictHash(row) === conflictHash);
    if (incumbent) {
      if (incumbent.url === candidate.url) {
        coalesceDuplicateDate(incumbent, candidate.sourcePublishedAt, patchPublishedAt);
      }
      return false;
    }
    // Hash seen with no row on the shelf: the page was displaced. Its DATED
    // incarnation may claim one fresh consideration — a dated row is
    // terminal (never displaced), so re-entry cannot oscillate; it ends the
    // page's run in a strictly better state. Undated re-entry stays blocked,
    // which is what makes the no-oscillation argument hold.
    if (!hasDisplayableDate(candidate, patchPublishedAt)) return false;
  }
  let displaceIndex = -1;
  if (observations.length >= MAX_OBSERVATIONS_PER_RUN && hasDisplayableDate(candidate, patchPublishedAt)) {
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      if (!hasDisplayableDate(observations[index], patchPublishedAt)) {
        displaceIndex = index;
        break;
      }
    }
  }
  // Every other rule still applies to a displacing candidate: the shared gate
  // sees one open slot only when an undated row is actually giving one up.
  if (!shouldCollectObservation({
    title: candidate.title,
    snippet: candidate.snippet,
    url: candidate.url,
    sourceDomain: candidate.sourceDomain,
    observationKind: candidate.kind,
  }, displaceIndex >= 0 ? observations.length - 1 : observations.length)) {
    return false;
  }
  seenConflictHashes.add(conflictHash);
  if (displaceIndex >= 0) {
    // In place, inheriting the displaced row's ordinal. The displaced row's
    // hash stays in the seen set: one consideration per run, so a page cannot
    // oscillate in and out of the shelf.
    observations.splice(displaceIndex, 1, candidate);
  } else {
    observations.push(candidate);
  }
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
  patchPublishedAt: string | null = null,
  storedDatesByUrlHash: ReadonlyMap<string, string | null> = new Map(),
): Promise<void> {
  if (observations.length === 0) return;
  try {
    const byHash = new Map<string, ObservationCandidate>();
    for (const observation of observations) {
      const hash = observationConflictHash(observation);
      if (!byHash.has(hash)) byHash.set(hash, observation);
    }
    // The RPC inserts in array order and stops minting new rows at the patch
    // cap, so ordinal IS priority under scarcity. Displayably dated rows go
    // first: when a patch's shelf is nearly full, the remaining capacity must
    // not be spent on rows the Brief can never render while a renderable one
    // waits at the tail. Stable within each class — collection order still
    // breaks ties.
    const entries = [...byHash.entries()];
    const prioritized = [
      ...entries.filter(([, observation]) => hasCertifiedDisplayableDate(observation, patchPublishedAt)),
      ...entries.filter(([, observation]) => !hasCertifiedDisplayableDate(observation, patchPublishedAt)),
    ];
    // The payload date contract the RPC's coalesce relies on: non-null means
    // "the Brief can render this". For rows carrying the date_contract
    // marker, the update branch prefers the incoming date, so every non-null
    // value must be a step toward renderability — a displayable date heals a
    // bad stored one, an undisplayable sighting arrives as NULL and
    // preserves whatever is stored (and, for a new row, stores NULL that a
    // later displayable sighting can fill, instead of a junk date the old
    // backfill could never touch). Certification requires the era floor to
    // have actually run — see hasCertifiedDisplayableDate — so a run with
    // unknown patch metadata withholds every date rather than vouch for one
    // the floor never judged. The marker is the in-band version gate:
    // payloads without it — an in-flight or rolled-back older deployment —
    // get the legacy stored-first coalesce, so no deploy ordering can let an
    // unvetted date replace a stored good one.
    //
    // One further restriction on top of that contract: a row that ALREADY has a
    // renderable stored date keeps it. Re-observation may FILL a null date and
    // HEAL an unrenderable one, but it may not overwrite a good date with a
    // different good date — the first verified publication date for a page is
    // the one a reader saw, and later sightings of the same page are not new
    // evidence about when it was published. Withholding sends NULL, which the
    // RPC's coalesce turns into "leave the stored value alone".
    const keepsStoredDate = (hash: string, observation: ObservationCandidate): boolean => {
      const stored = storedDatesByUrlHash.get(hash);
      if (!stored) return false;
      return hasDisplayableDate({ sourcePublishedAt: stored, observedAt: observation.observedAt }, patchPublishedAt);
    };
    const rows = prioritized.map(([hash, observation]) => ({
      kind: observation.kind,
      title: observation.title.slice(0, 240),
      url: observation.url,
      url_hash: hash,
      source_domain: observation.sourceDomain,
      snippet: observation.snippet.slice(0, 500),
      source_published_at:
        hasCertifiedDisplayableDate(observation, patchPublishedAt) && !keepsStoredDate(hash, observation)
          ? observation.sourcePublishedAt
          : null,
      date_contract: "displayable_only",
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
