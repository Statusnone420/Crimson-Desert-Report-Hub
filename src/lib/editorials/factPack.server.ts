import "server-only";

import { getActivityHistory } from "@/lib/activityHistory.server";
import { buildFactPack, type FactPack, type FactPackMetrics, type IssueAggregate, type IssueBoard } from "@/lib/editorials/factPack";
import { needsFullIssueCard } from "@/lib/evidence";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { getIssuesData } from "@/lib/queries";

const SITE_NAMES: Record<string, string> = {
  "steamcommunity.com": "Steam Community",
  "store.steampowered.com": "Steam",
  "reddit.com": "Reddit",
  "old.reddit.com": "Reddit",
  "youtube.com": "YouTube",
  "x.com": "X",
  "twitter.com": "X",
};

/** A public post's site name. Only the count per site leaves this function, never a URL. */
export function siteName(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SITE_NAMES[host] ?? host;
  } catch {
    return null;
  }
}

type IssuesData = Awaited<ReturnType<typeof getIssuesData>>;

/**
 * The issue board's public aggregates: counts, labels and titles. No report text, no URLs,
 * no hashes. A failed check-in read makes the board unavailable, like a failed board read:
 * zero check-ins would be a made-up fact, and the labels and relevance rest on them.
 */
export function issueBoard(data: IssuesData): IssueBoard {
  if (data.boardReadFailed || data.currentPatch.source === "fallback") return { available: false };
  if (data.checkinsAvailable === false || data.clusters.some((cluster) => cluster.checkinsAvailable === false)) return { available: false };
  const issues: IssueAggregate[] = data.clusters.filter(needsFullIssueCard).map((cluster) => {
    const postsBySite: Record<string, number> = {};
    const posts = data.signalsByCluster[cluster.id] ?? [];
    for (const post of posts) {
      const site = siteName(post.source_url);
      if (site) postsBySite[site] = (postsBySite[site] ?? 0) + 1;
    }
    return {
      id: cluster.id,
      title: cluster.title,
      approvedReports: cluster.directReportCount,
      checkins: cluster.confirmations.affectedCount,
      checkinNetworks: cluster.confirmations.affectedNetworks,
      publicPosts: posts.length,
      postsBySite,
      officialFixListed: !data.officialClaimsUnavailable && (data.officialClaimsByCluster[cluster.id]?.length ?? 0) > 0,
      stillHappening: cluster.readout.state === "still_happening",
      strength: cluster.strengthScore,
    };
  });
  return { available: true, patchVersion: data.currentPatch.version, issues };
}

/** Builds the pack from the same cached public readers the site's pages use. */
export async function readFactPack(now: Date, previous: FactPackMetrics | null): Promise<FactPack> {
  const [patches, history, issues] = await Promise.all([
    getPatchPublications(),
    getActivityHistory(90),
    getIssuesData().catch(() => null),
  ]);
  return buildFactPack({
    now,
    patches: patches.unavailable ? { available: false } : { available: true, editions: patches.editions },
    history,
    board: issues ? issueBoard(issues) : { available: false },
    previous,
  });
}
