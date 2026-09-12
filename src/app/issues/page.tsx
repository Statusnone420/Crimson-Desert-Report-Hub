import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { IssueBoard, type IssueBoardEntry } from "@/components/newspaper/IssueBoard";
import { CATEGORY_LABELS, PLATFORM_LABELS, PLATFORMS } from "@/lib/constants";
import { displayDescription, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";
import { getIssuesData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "Issue Board",
    "/issues",
    "Compare Crimson Desert issues, official fixes and anonymous community check-ins on the current patch. No account or written report.",
    parent,
  );
}

export const revalidate = 300;

export default async function IssuesPage() {
  const { clusters, excerptsByCluster, signalsByCluster, currentPatch, boardReadFailed = false, officialClaimsByCluster = {}, officialClaimsUnavailable = false, checkinsAvailable = true } = await getIssuesData();
  if (boardReadFailed) {
    return <PublicShell active="issues"><div className="dispatch-container"><section className="board-empty" aria-labelledby="board-unavailable-title"><h1 id="board-unavailable-title">The issue board is unavailable.</h1><p>The public issue records could not be read. Check-ins need a visible issue; try again later.</p><Link href="/patches" className="dispatch-primary-action">Read the patch record →</Link></section></div></PublicShell>;
  }

  const active = clusters.filter(needsFullIssueCard);
  const watchlist = clusters.filter((cluster) => !needsFullIssueCard(cluster));
  const { candidates, monitored } = splitWatchlistByCandidates(watchlist);

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
      earlierCheckinCount: cluster.earlierCheckinCount ?? 0,
      checkinsAvailable: cluster.checkinsAvailable !== false,
      reportPlatforms,
      platformCounts: PLATFORMS.map((platform) => ({
        label: PLATFORM_LABELS[platform],
        reports: cluster.reportPlatformCounts[platform] ?? 0,
        confirmations: cluster.confirmations.byPlatform[platform]?.count ?? 0,
        experiences: Object.entries(cluster.confirmations.byPlatform[platform]?.byKind ?? {}).map(([kind, count]) => `${count} ${{ have_it: "happening", not_happening: "not happening", fixed_for_me: "fixed for me", still_happening: "still happening" }[kind] ?? kind}`).join(" · "),
      })).filter((row) => row.reports > 0 || row.confirmations > 0),
      excerpts: (excerptsByCluster[cluster.id] ?? []).map((excerpt) => ({ text: excerpt.text, platform: PLATFORM_LABELS[excerpt.platform as keyof typeof PLATFORM_LABELS] ?? excerpt.platform })),
      sourceLeadCount: (signalsByCluster[cluster.id] ?? []).length,
      sourceLeads: (signalsByCluster[cluster.id] ?? []).map((signal) => ({ id: signal.id, source: signal.source, url: signal.source_url, summary: signal.summary })),
      ask: cluster.readout.ask,
      poll: cluster.readout.poll,
      hasCurrentClaim: cluster.readout.hasCurrentClaim,
      officialClaims: officialClaimsByCluster[cluster.id] ?? [],
      officialClaimsUnavailable,
      confirmationCounts: cluster.readout.ask?.kinds.includes("have_it")
        ? { have_it: cluster.confirmations.byKind.have_it.count, not_happening: cluster.confirmations.byKind.not_happening.count }
        : { fixed_for_me: cluster.confirmations.pollFixedCount, still_happening: cluster.confirmations.pollStillCount },
      storageScope: currentPatch.version,
    };
  }

  return (
    <PublicShell active="issues">
      <div id="issues-top" className="dispatch-container article-paper issues-paper">
        <a className="skip" href="#board">Skip to the issue board</a>
        <section className="board-heading"><Link className="back-link" href="/">← Back to the front page</Link><div className="board-heading-row"><div><p className="kicker">Issue board · Patch {currentPatch.version}</p><h1>What are you seeing?</h1><p className="board-deck">Find an issue. Choose your experience and platform.</p><p className="board-contribution-note">No account. No written report. A fresh tally for every patch.</p></div><Link href="/patches" className="board-patch-link"><span>Coming from the patch notes?</span><strong>Read the claims record</strong><span>Visit the patch desk →</span></Link></div></section>
        {!checkinsAvailable ? <p className="np-error" role="status">Current-patch check-ins could not be loaded. Earlier records remain visible; new responses are temporarily unavailable.</p> : null}
        <IssueBoard published={active.map(entryFrom)} watchlist={candidates.map(entryFrom)} monitoredCount={monitored.length} emptyPatchVersion={currentPatch.version} />
        <div className="article-bottom"><Link href="/patches">← Back to the patch desk</Link><a href="#issues-top">Back to top ↑</a></div>
      </div>
    </PublicShell>
  );
}
