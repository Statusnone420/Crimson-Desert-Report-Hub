import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { IssueBoard, type IssueBoardEntry } from "@/components/newspaper/IssueBoard";
import { CATEGORY_LABELS, PLATFORM_LABELS, PLATFORMS } from "@/lib/constants";
import { displayDescription, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";
import { patchFamilyKey } from "@/lib/patchWatch";
import { getIssuesData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Issue Board",
    "/issues",
    "The Issue Board lays out Crimson Desert player reports and source leads, showing how much backing reports have and where the claimed fixes stand.",
    parent,
  );
}

export const revalidate = 300;

export default async function IssuesPage() {
  const { clusters, excerptsByCluster, signalsByCluster, currentPatch, boardReadFailed = false } = await getIssuesData();
  if (boardReadFailed) {
    return <PublicShell active="issues"><div className="dispatch-container"><section className="board-empty" aria-labelledby="board-unavailable-title"><h1 id="board-unavailable-title">The issue board is unavailable.</h1><p>The public issue records could not be read. This is not a report that no issues are being tracked.</p><Link href="/report" className="dispatch-primary-action">File a player report →</Link></section></div></PublicShell>;
  }

  const active = clusters.filter(needsFullIssueCard);
  const watchlist = clusters.filter((cluster) => !needsFullIssueCard(cluster));
  const { candidates, monitored } = splitWatchlistByCandidates(watchlist);
  const patchFamily = patchFamilyKey(currentPatch.version) ?? currentPatch.version;

  function entryFrom(cluster: (typeof clusters)[number]): IssueBoardEntry {
    const reportPlatforms = Object.entries(cluster.reportPlatformCounts).filter(([, count]) => count > 0).map(([platform, count]) => `${PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform} (${count})`);
    return {
      id: cluster.id,
      title: cluster.title,
      category: cluster.category,
      categoryLabel: CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category,
      description: displayDescription(cluster.title, cluster.description),
      status: cluster.readout.label,
      tone: cluster.readout.tone,
      sentence: cluster.readout.sentence,
      directReportCount: cluster.directReportCount,
      signalCount: cluster.signalCount,
      candidateSignalCount: cluster.candidateSignalCount,
      confirmationCount: cluster.confirmations.totalCount,
      reportPlatforms,
      platformCounts: PLATFORMS.map((platform) => ({
        label: PLATFORM_LABELS[platform],
        reports: cluster.reportPlatformCounts[platform] ?? 0,
        confirmations: cluster.confirmations.byPlatform[platform]?.count ?? 0,
      })).filter((row) => row.reports > 0 || row.confirmations > 0),
      excerpts: (excerptsByCluster[cluster.id] ?? []).map((excerpt) => ({ text: excerpt.text, platform: PLATFORM_LABELS[excerpt.platform as keyof typeof PLATFORM_LABELS] ?? excerpt.platform })),
      sourceLeadCount: (signalsByCluster[cluster.id] ?? []).length,
      sourceLeads: (signalsByCluster[cluster.id] ?? []).map((signal) => ({ id: signal.id, source: signal.source, url: signal.source_url, summary: signal.summary })),
      ask: cluster.readout.ask,
      poll: cluster.readout.poll,
      confirmationCounts: cluster.readout.ask?.kinds.includes("have_it")
        ? { have_it: cluster.confirmations.byKind.have_it.count }
        : { fixed_for_me: cluster.confirmations.pollFixedCount, still_happening: cluster.confirmations.pollStillCount },
      storageScope: cluster.readout.ask?.kinds.includes("have_it") ? patchFamily : currentPatch.version,
    };
  }

  return (
    <PublicShell active="issues">
      <div id="issues-top" className="dispatch-container article-paper issues-paper">
        <a className="skip" href="#board">Skip to the issue board</a>
        <section className="board-heading"><Link className="back-link" href="/">← Back to the front page</Link><div className="board-heading-row"><div><p className="kicker">Issue board · Patch {currentPatch.version}</p><h1>The player record.</h1><p className="board-deck">Compare what you’re seeing with reports from other players.</p></div><Link href="/patches" className="board-patch-link"><span>Coming from the patch notes?</span><strong>Read the claims record</strong><span>Visit the patch desk →</span></Link></div></section>
        <IssueBoard published={active.map(entryFrom)} watchlist={candidates.map(entryFrom)} monitoredCount={monitored.length} emptyPatchVersion={currentPatch.version} />
        <div className="article-bottom"><Link href="/patches">← Back to the patch desk</Link><a href="#issues-top">Back to top ↑</a></div>
      </div>
    </PublicShell>
  );
}
