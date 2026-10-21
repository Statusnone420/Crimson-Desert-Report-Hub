import "server-only";

import { getActivityHistory } from "@/lib/activityHistory.server";
import { CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
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
 * no hashes. A failed check-in or official-claim read makes the board unavailable, like a
 * failed board read: zero check-ins or "no listed fix" would be made-up facts, and the
 * labels and relevance rest on them.
 */
export function issueBoard(data: IssuesData): IssueBoard {
  if (data.boardReadFailed || data.currentPatch.source === "fallback" || data.officialClaimsUnavailable) return { available: false };
  if (data.checkinsAvailable === false || data.clusters.some((cluster) => cluster.checkinsAvailable === false)) return { available: false };
  const issues: IssueAggregate[] = data.clusters.filter(needsFullIssueCard).map((cluster) => {
    const postsBySite: Record<string, number> = {};
    const posts = data.signalsByCluster[cluster.id] ?? [];
    for (const post of posts) {
      const site = siteName(post.source_url);
      if (site) postsBySite[site] = (postsBySite[site] ?? 0) + 1;
    }
    const claims = data.officialClaimsByCluster[cluster.id] ?? [];
    const { state } = cluster.readout;
    return {
      id: cluster.id,
      title: cluster.title,
      approvedReports: cluster.directReportCount,
      publicPosts: posts.length,
      postsBySite,
      officialFixListed: claims.length > 0,
      stillHappening: state === "still_happening",
      strength: cluster.strengthScore,
      // Check-ins and exact-patch reports since the fix, counted the way the issue page counts them.
      afterFix: claims.length ? {
        fixes: claims.map((claim) => claim.text),
        readout: state === "still_happening" || state === "players_say_fixed" ? state : "unverified",
        fixedCheckins: cluster.confirmations.pollFixedCount,
        stillCheckins: cluster.confirmations.pollStillCount,
        stillNetworks: cluster.confirmations.pollStillNetworks,
        reportsSince: cluster.postClaimEvidenceCount,
      } : null,
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
    // The reviewed official notices on the catch-up page; patch notes reach the pack as patches.
    // Their highlights can draw on several sources, so only the lines tied to each notice go in.
    notices: CATCH_UP_MILESTONES.filter((milestone) => milestone.kind === "announcement")
      .map(({ id, publishedAt, noticeSays, source, release }) => ({ id, publishedAt, says: noticeSays, source, release })),
    history,
    board: issues ? issueBoard(issues) : { available: false },
    previous,
  });
}
