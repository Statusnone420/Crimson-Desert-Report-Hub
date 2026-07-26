/**
 * The one date gate a context-lane observation must clear to reach the Brief.
 *
 * Both the public lane query and the operator's "publishable" count read it, so
 * the operator page can never advertise an item as eligible that the public page
 * would reject — a non-null date is not the same thing as a usable one.
 */

export const OBSERVATION_FUTURE_SKEW_MS = 48 * 60 * 60 * 1000;

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
