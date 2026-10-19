import type { FactPackDeltas } from "@/lib/editorials/factPack";
import type { RelevanceLevel } from "@/lib/editorials/settings";

/**
 * How much happened since the last edition:
 * +3 new official update notes, or +2 when only hotfixes are new;
 * +1 per newly Reported or Confirmed issue, at most +3;
 * players online moved 10% (+1) or 25% (+2);
 * the 7-day Steam review share moved 5 points (+1);
 * Twitch viewers moved 25% (+1).
 */
export function relevanceScore(deltas: FactPackDeltas): number {
  let score = 0;
  if (deltas.newUpdate) score += 3;
  else if (deltas.newPatchVersions.length) score += 2;
  score += Math.min(deltas.newPatternIssueIds.length, 3);
  const players = deltas.playersChangePct === null ? 0 : Math.abs(deltas.playersChangePct);
  if (players >= 25) score += 2;
  else if (players >= 10) score += 1;
  if (deltas.reviewShareChangePoints !== null && Math.abs(deltas.reviewShareChangePoints) >= 5) score += 1;
  if (deltas.twitchChangePct !== null && Math.abs(deltas.twitchChangePct) >= 25) score += 1;
  return score;
}

/** always runs every slot; normal needs 2; strict needs 4. */
export function meetsThreshold(score: number, level: RelevanceLevel): boolean {
  if (level === "always") return true;
  return score >= (level === "strict" ? 4 : 2);
}
