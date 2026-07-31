/**
 * The complete gate a context-lane observation must clear to reach the Brief.
 *
 * Both the public lane read and the operator's "publishable" count call it, so
 * the operator page can never advertise an item the Brief would drop. A usable
 * date is only one of the conditions: a rejected item stays in the operator's
 * list with `is_public = false`, and an item that fails the relevance read is
 * dropped after the query returns. Keeping every condition in one function is
 * what stops the two surfaces from drifting apart.
 */

import { mentionsOnlyOtherPatch } from "@/lib/automation/eligibility";
import { hasCrimsonDesertContext, hasUnsupportedSourceContext } from "@/lib/automation/relevance";

export const OBSERVATION_FUTURE_SKEW_MS = 48 * 60 * 60 * 1000;

const RFC_1123_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * The two date shapes the pipeline actually receives (probed live 2026-07-27):
 * Tavily's news index emits RFC 1123 — `Fri, 24 Jul 2026 00:00:00 GMT` — while
 * ISO 8601 arrives from the database and from every date this codebase mints
 * itself. These two families are the entire legitimate supply.
 *
 * Both patterns anchor the FULL string and separate with plain spaces only —
 * never `\s`, which in JavaScript matches U+00A0 and friends, characters
 * PostgreSQL's datetime scanner rejects outright (probed).
 */
const RFC_1123_DATE =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), +)?(\d{1,2}) +(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{4})(?: +\d{2}:\d{2}:\d{2})? +(?:GMT|UTC)$/i;

/**
 * Date, optional time, optional zone — nothing else. The tail alternation is
 * the load-bearing part: an unanchored prefix match would wave through any
 * trailing text JavaScript's lenient legacy parser tolerates, and PostgreSQL
 * rejects several of those (`2026-07-24 00:00:00 GMT-0500`: the zone is the
 * whole reason the cast fails). Offsets capture for the ±15:59 bound check.
 */
const ISO_8601_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)?)?$/i;

/** JavaScript rolls impossible days over (Feb 30 -> Mar 2); PostgreSQL rejects them. */
function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const composed = new Date(Date.UTC(year, month - 1, day));
  return (
    composed.getUTCFullYear() === year &&
    composed.getUTCMonth() === month - 1 &&
    composed.getUTCDate() === day
  );
}

/** ASCII blanks only — see the trim note on hasUsableDate. */
export const ASCII_EDGE_BLANKS = /^[ \t]+|[ \t]+$/g;

/**
 * A date only counts if it will survive persistence: the RPC casts the string
 * with `::timestamptz` and stores a failed cast as NULL, leaving the row
 * exactly as unrenderable as one that never carried a date.
 *
 * This is an ALLOWLIST of the two formats above, not a test of what JavaScript
 * can parse. JavaScript's parser is the wrong oracle for a PostgreSQL cast: it
 * accepts strings PostgreSQL rejects — rolled-over calendar days in any format
 * (02/30/2026, `Mon, 30 Feb 2026`), timezone offsets past PostgreSQL's ±15:59
 * displacement limit, zone suffixes like `GMT-0500` — and each acceptance would
 * hand priority to a value that persists as undated. So both branches anchor
 * their full pattern, validate the literal calendar components (from the
 * string, not a UTC round-trip, because an offset timestamp can legitimately
 * sit on a different UTC calendar day), the ISO branch bounds the offset, and
 * Date.parse guards only what remains (time-of-day ranges, overall
 * well-formedness — where JavaScript is the stricter side).
 *
 * Anything else returns false, which is the safe direction: an unrecognized
 * format loses priority, and callers send it onward as NULL rather than letting
 * a date this module cannot vouch for replace or occupy stored state. The
 * observation itself still persists; a later sighting in a vouched format fills
 * the date in. (Incidentally the allowlist also rejects years below 100:
 * Date.UTC maps them to 1900+, so isRealCalendarDay rejects them — not
 * designed, but the safe direction, and no real source dates from 99 AD.)
 *
 * The edge trim strips ASCII blanks ONLY, matching what PostgreSQL itself
 * ignores. String.prototype.trim would also strip U+00A0 — which PostgreSQL
 * rejects — and since the RPC receives the RAW string, trimming more than the
 * cast forgives would vouch for a value the cast then nulls.
 */
export function hasUsableDate(sourcePublishedAt: string | null | undefined): boolean {
  if (!sourcePublishedAt) return false;
  const value = sourcePublishedAt.replace(ASCII_EDGE_BLANKS, "");
  if (!Number.isFinite(Date.parse(value))) return false;
  const iso = ISO_8601_DATE.exec(value);
  if (iso) {
    if (!isRealCalendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return false;
    if (!iso[4]) return true;
    return Number(iso[5]) * 60 + Number(iso[6] ?? "0") <= 15 * 60 + 59;
  }
  const rfc = RFC_1123_DATE.exec(value);
  if (!rfc) return false;
  return isRealCalendarDay(Number(rfc[3]), RFC_1123_MONTHS[rfc[2].toLowerCase()], Number(rfc[1]));
}

/** The kinds the Brief renders, across both lanes. Mirrors the lane queries. */
const BRIEF_OBSERVATION_KINDS = ["patch_release", "press_reception", "fix_announcement", "community_ask"];

/**
 * Observations belong to the patch era they were seen in, floored to the patch's
 * UTC publish day so a source published hours before the notes went up still
 * counts as part of that patch's conversation.
 */
export function patchEraFloorMs(patchPublishedAt: string | null): number {
  if (!patchPublishedAt) return Number.NaN;
  const publishedAt = new Date(patchPublishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return Number.NaN;
  return new Date(publishedAt).setUTCHours(0, 0, 0, 0);
}

export function isDisplayableDatedObservation(
  row: { source_published_at?: string | null },
  patchPublishedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  const published = row.source_published_at ? new Date(row.source_published_at).getTime() : Number.NaN;
  if (!Number.isFinite(published)) return false;
  if (published > nowMs + OBSERVATION_FUTURE_SKEW_MS) return false;
  const eraStart = patchEraFloorMs(patchPublishedAt);
  if (Number.isFinite(eraStart) && published < eraStart) return false;
  return true;
}

/** Relevance read: still about Crimson Desert, from a supported source, this patch. */
export function isPublicObservationEligible(
  row: { title: string; snippet: string | null; url: string; source_domain: string | null },
  patchVersion: string,
): boolean {
  const context = {
    title: row.title,
    snippet: row.snippet ?? "",
    url: row.url,
    sourceDomain: row.source_domain,
  };
  if (!hasCrimsonDesertContext(context) || hasUnsupportedSourceContext(context)) return false;
  return !mentionsOnlyOtherPatch(`${row.title} ${row.snippet ?? ""}`, patchVersion);
}

type BriefObservationRow = {
  kind: string;
  title: string;
  url: string;
  source_domain: string | null;
  snippet: string | null;
  source_published_at?: string | null;
  created_at?: string | null;
  is_public: boolean;
};

/**
 * Every condition the Brief applies EXCEPT the publication-date gate:
 * moderation, kind and relevance. Split out because Community Asks may render
 * without a publication date — they fall back to first-discovery time — while
 * From the Wire still requires one. Both lanes share this half so an item can
 * never slip a moderation or relevance gate by taking the undated route.
 */
export function passesNonDateBriefGates(
  row: BriefObservationRow,
  patchVersion: string,
): boolean {
  // Rejecting an item sets is_public false and leaves it in the operator's list.
  // Counting it as publishable would name the one thing just taken off the Brief
  // as still headed for it.
  if (!row.is_public) return false;
  if (!BRIEF_OBSERVATION_KINDS.includes(row.kind)) return false;
  return isPublicObservationEligible(row, patchVersion);
}

/**
 * First-discovery fallback for the Community Asks lane only.
 *
 * `created_at` is when the radar first saw the row's current URL, NOT when that
 * page was published. It starts at insert time and is rebound only when a
 * serialized community-ask campaign advances the same row to a new thread URL.
 * It may stand in for a publication date only inside the current patch's era,
 * so an ask carried over from an earlier patch cannot present itself as part of
 * this patch's conversation.
 *
 * Fails closed on an unknown or unparseable patch publication time: with no era
 * to compare against there is no honest way to say the discovery belongs to this
 * patch, so nothing undated renders.
 */
export function isFirstSeenByRadarRenderable(
  createdAt: string | null | undefined,
  patchPublishedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  const patchPublished = patchPublishedAt ? new Date(patchPublishedAt).getTime() : Number.NaN;
  if (!Number.isFinite(patchPublished)) return false;
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(created)) return false;
  // A discovery time is minted by the database clock, so a far-future value is
  // corrupt rather than early news; the same skew bound the date gate uses keeps
  // one out of the lane.
  if (created > nowMs + OBSERVATION_FUTURE_SKEW_MS) return false;
  return created >= patchPublished;
}

/** Every condition the Brief applies to a DATED observation, in one place. */
export function isBriefEligibleObservation(
  row: BriefObservationRow,
  patch: { version: string; publishedAt: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!isDisplayableDatedObservation(row, patch.publishedAt, nowMs)) return false;
  return passesNonDateBriefGates(row, patch.version);
}

/**
 * The complete renderability rule across both Brief lanes.
 *
 * Wire remains publication-date-only. Community Asks may instead use their
 * URL-bound first-seen clock, but only when the date is genuinely absent and
 * every moderation, kind, relevance and current-patch gate still passes.
 * Keeping this decision shared prevents the operator count from contradicting
 * the public lane.
 */
export function isBriefRenderableObservation(
  row: BriefObservationRow,
  patch: { version: string; publishedAt: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (isBriefEligibleObservation(row, patch, nowMs)) return true;
  if (row.kind !== "community_ask" || row.source_published_at) return false;
  if (!passesNonDateBriefGates(row, patch.version)) return false;
  return isFirstSeenByRadarRenderable(row.created_at, patch.publishedAt, nowMs);
}
