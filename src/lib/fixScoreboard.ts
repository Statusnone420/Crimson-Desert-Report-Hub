import type { ReadoutTone } from "@/lib/readout";

/**
 * Claimed-fix scoreboard composer (Patch Brief).
 *
 * Joins the two sides of a patch only where the engine already joined them:
 * official claimed fixes come verbatim from official_patch_claimed_fixes, and
 * "players verify" rows are exactly the watched clusters whose fix claim the
 * lifecycle pass tied to the current patch. The UI never invents a claim→issue
 * mapping, and verdict labels/tones come from the shared issue readout.
 */

export type ScoreboardClaim = {
  fixText: string;
  category: string | null;
};

export type ScoreboardClusterInput = {
  slug: string;
  title: string;
  fix_claimed_patch_version?: string | null;
  readout: {
    label: string;
    tone: ReadoutTone;
    poll: { fixedCount: number; stillCount: number; escalated: boolean } | null;
  };
};

export type ScoreboardVerdictRow = {
  slug: string;
  title: string;
  label: string;
  tone: ReadoutTone;
  fixedCount: number;
  stillCount: number;
};

export type FixScoreboard = {
  totalClaims: number;
  /** [categoryKey, count] sorted by count desc; null categories grouped as "general". */
  categories: [string, number][];
  verifying: ScoreboardVerdictRow[];
};

export function buildFixScoreboard({
  claims,
  clusters,
  patchVersion,
}: {
  claims: ScoreboardClaim[];
  clusters: ScoreboardClusterInput[];
  patchVersion: string;
}): FixScoreboard | null {
  const verifying = clusters
    .filter((cluster) => cluster.fix_claimed_patch_version === patchVersion)
    .map((cluster) => ({
      slug: cluster.slug,
      title: cluster.title,
      label: cluster.readout.label,
      tone: cluster.readout.tone,
      fixedCount: cluster.readout.poll?.fixedCount ?? 0,
      stillCount: cluster.readout.poll?.stillCount ?? 0,
    }));

  if (claims.length === 0 && verifying.length === 0) return null;

  const categoryCounts = new Map<string, number>();
  for (const claim of claims) {
    const key = claim.category ?? "general";
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const categories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);

  return { totalClaims: claims.length, categories, verifying };
}
