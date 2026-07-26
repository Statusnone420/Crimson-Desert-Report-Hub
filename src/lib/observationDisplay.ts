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

/** Every condition the Brief applies, in one place. */
export function isBriefEligibleObservation(
  row: {
    kind: string;
    title: string;
    url: string;
    source_domain: string | null;
    snippet: string | null;
    source_published_at?: string | null;
    is_public: boolean;
  },
  patch: { version: string; publishedAt: string | null },
  nowMs: number = Date.now(),
): boolean {
  // Rejecting an item sets is_public false and leaves it in the operator's list.
  // Counting it as publishable would name the one thing just taken off the Brief
  // as still headed for it.
  if (!row.is_public) return false;
  if (!BRIEF_OBSERVATION_KINDS.includes(row.kind)) return false;
  if (!isDisplayableDatedObservation(row, patch.publishedAt, nowMs)) return false;
  return isPublicObservationEligible(row, patch.version);
}
