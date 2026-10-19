import type { FactPackDeltas } from "@/lib/editorials/factPack";
import type { RelevanceLevel } from "@/lib/editorials/settings";

/**
 * How much happened since the last edition:
 * +3 new official update notes, or +2 when only hotfixes are new;
 * +1 per newly Reported or Confirmed issue, at most +3;
 * +1 per listed fix whose Hub check newly reads Still reported or Confirmed by players, at most +3.
 * Steam and Twitch numbers are supporting context in the pack and never add to the score.
 */
export function relevanceScore(deltas: FactPackDeltas): number {
  let score = 0;
  if (deltas.newUpdate) score += 3;
  else if (deltas.newPatchVersions.length) score += 2;
  score += Math.min(deltas.newPatternIssueIds.length, 3);
  score += Math.min(deltas.newVerdictIssueIds.length, 3);
  return score;
}

/** always runs every slot; normal needs 2; strict needs 4. */
export function meetsThreshold(score: number, level: RelevanceLevel): boolean {
  if (level === "always") return true;
  return score >= (level === "strict" ? 4 : 2);
}
