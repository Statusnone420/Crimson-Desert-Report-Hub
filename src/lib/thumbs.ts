export const THUMB_DIRECTIONS = ["up", "down"] as const;
export type ThumbDirection = (typeof THUMB_DIRECTIONS)[number];

/** Thumbs up a topic needs on the current patch, from different networks, before they count at all. */
export const THUMBS_BONUS_MIN_UPS = 10;

/**
 * What enough thumbs add to a topic's rank on the board. Every other rank point
 * is a whole post or report, so half a point only orders topics with the same
 * evidence. It never decides whether a topic is published.
 */
export const THUMBS_RANK_BONUS = 0.5;

export type ThumbTally = { up: number; down: number };

export function thumbsRankBonus(tally: ThumbTally | undefined): number {
  return tally && tally.up >= THUMBS_BONUS_MIN_UPS && tally.up > tally.down ? THUMBS_RANK_BONUS : 0;
}

/**
 * The issue board's order. Callers pass topics in evidence order; the sort is
 * stable, so the bonus only reorders topics with the same evidence.
 */
export function boardOrder<T extends { rankScore: number }>(topics: readonly T[]): T[] {
  return [...topics].sort((a, b) => b.rankScore - a.rankScore);
}
