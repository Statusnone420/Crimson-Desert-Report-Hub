import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import Link from "next/link";
import Image from "next/image";
import { PublicShell } from "@/components/dispatch/Chrome";
import { HomeNumbers } from "@/components/newspaper/HomeNumbers";
import { FrontPageReports } from "@/components/newspaper/FrontPageReports";
import { BeforeYouPlay } from "@/components/newspaper/BeforeYouPlay";
import { LaunchClock } from "@/components/newspaper/LaunchClock";
import { currentLaunch } from "@/lib/expansion";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { getActivityHistory } from "@/lib/activityHistory.server";
import { getBoardWatchSummary } from "@/lib/boardWatch.server";
import { needsFullIssueCard } from "@/lib/evidence";
import { MIN_DISTINCT_PLAYER_THREADS } from "@/lib/automation/promote";
import { CATEGORY_LABELS } from "@/lib/constants";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";
import { getPatchPublications } from "@/lib/patchPublications.server";
import { comparePatchVersions, frontPagePublications } from "@/lib/patchPublications";
import { matchesPatchVersion } from "@/lib/patchWatch";

export const revalidate = 300;
// The 16:9 source must cover the full portrait-frame height before cropping.
const storyImageSizes = "(max-width:650px) 100vw, (max-width:1000px) 42vw, 430px";
export default async function HomePage() {
  const [data, scanner, radar, publications, activity] = await Promise.all([getDashboardData(), getPublicScannerData(), getPatchRadarData(), getPatchPublications(), getActivityHistory()]);
  const patch = data.currentPatch;
  const patchUnverified = patch.source === "fallback";
  const reports = frontPagePublications(publications.articles);
  const newestPatchReport = reports.find((article) => article.patchVersion);
  const leadBehind = !patchUnverified && (!newestPatchReport?.patchVersion || comparePatchVersions(newestPatchReport.patchVersion, patch.version) < 0);
  const issues = data.topClusters.filter(needsFullIssueCard);
  const publishedCount = data.evidenceUnavailable || data.publicLeadsUnavailable || data.checkinsAvailable === false ? null : issues.length;
  const claims = data.claimsUnavailable ? [] : data.claimedFixes.slice(0,2);
  const watch = patchUnverified ? null : await getBoardWatchSummary(patch);
  const watchSummary = watch === "unavailable" ? null : watch;
  const edition = publications.editions.find((item) => matchesPatchVersion(item.version, patch.version));
  const latestPatch = patchUnverified ? null : {
    version: patch.version,
    publishedAt: patch.publishedAt,
    fixes: edition ? edition.totalClaimedFixes ?? edition.fixes.length : null,
    // A failed notes read is not an empty record.
    notesUnavailable: !edition && publications.unavailable,
  };
  const watchingOnly = publishedCount === 0 && watchSummary !== null && watchSummary.threads > 0;
  const now = new Date().getTime();
  const launch = currentLaunch(now);
  const readings = <BeforeYouPlay history={activity} latestPatch={latestPatch} watch={watch} launch={launch?.phase === "watch" ? launch : undefined} now={now} />;
  return <PublicShell active="brief" masthead><script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(webSiteJsonLd())}}/>
    {launch?.phase === "countdown" ? <LaunchClock at={launch.at} days={launch.days} /> : null}
    {/* For launch week the readings lead the page as the launch watch. */}
    {launch?.phase === "watch" ? readings : null}
    <FrontPageReports articles={reports} leadUnavailable={publications.unavailable || leadBehind} latestPatchVersion={patchUnverified ? undefined : patch.version} />
    <PublicationFeed />
    {patchUnverified && <p className="np-error" role="status">The current patch could not be verified.</p>}
    <section className="stories" id="patches">{claims.map((claim,index) => <article key={claim.fixText}><div className={`story-image ${index === 0 ? 'quest' : 'combat'}`}><Image loading="eager" src={index === 0 ? '/official/content.jpg' : '/official/combat.jpg'} width={1920} height={1080} sizes={storyImageSizes} alt={index === 0 ? 'An adventurer overlooking a riverside settlement' : 'Two fighters in a stone courtyard'}/></div><div><p className="kicker">{claim.section || (claim.category && CATEGORY_LABELS[claim.category as keyof typeof CATEGORY_LABELS]) || 'Official notes'}</p><h2 className="story-title"><Link href="/patches#claims">{claim.fixText}</Link></h2><p>{patchUnverified ? 'Listed in the official notes.' : `Listed in the official notes for ${patch.version}.`}</p><ReadingLink className="action" href="/patches#claims">Browse the fix record</ReadingLink></div></article>)}{claims.length===0 && <article><div><p className="kicker">The patch desk</p><h2 className="story-title">{data.claimsUnavailable ? 'Official claims are unavailable.' : 'The official record.'}</h2><p>{data.claimsUnavailable ? 'The claims read did not complete. No count is assumed to be zero.' : patchUnverified ? 'No claimed fixes were returned.' : 'No claimed fixes are recorded for this patch yet.'}</p><ReadingLink className="action" href="/patches">Read the patch desk</ReadingLink></div></article>}<aside id="board"><p className="kicker">Community record</p><h2>{publishedCount === null ? 'Issue counts unavailable' : watchingOnly ? `Watching ${watchSummary.topics} ${watchSummary.topics === 1 ? 'topic' : 'topics'}` : `${publishedCount} tracked ${publishedCount === 1 ? 'issue' : 'issues'}`}</h2><p className="small">{watchingOnly ? `The scanner is watching these on this patch. One goes on the board when ${MIN_DISTINCT_PLAYER_THREADS} different players post about it or another site backs it up.` : 'What players are running into on this patch.'}</p><dl><div><dt>Published issues</dt><dd>{publishedCount ?? 'Unavailable'}</dd></div>{watchingOnly ? <div><dt>Forum threads this patch</dt><dd>{watchSummary.threads}</dd></div> : null}<div><dt>Scanner leads</dt><dd>{radar.connected ? radar.recurring.trackedLeads : 'Unavailable'}</dd></div><div><dt>Claimed fixes</dt><dd>{data.claimsUnavailable ? 'Unavailable' : data.claimedFixes.length}</dd></div></dl><div className="report-actions"><ReadingLink className="action" href="/issues">{publishedCount === null ? "Read the issue board" : `All ${publishedCount} published ${publishedCount === 1 ? "issue" : "issues"}`}</ReadingLink><ReadingLink variant="quiet" className="chart-link" href="/issues#board">Add a check-in</ReadingLink></div></aside></section>
    {/* The lead story opens the page; the readings sit with the other numbers. */}
    {launch?.phase === "watch" ? null : readings}
    <HomeNumbers steam={scanner.steamPulse} steamUnavailable={scanner.pulseReadFailures.includes('steam')} radar={radar.connected ? radar : null}/>
    <PublicationFeed type="video" />
    <ReadingLink variant="quiet" className="chart-link" href="/watch">More videos</ReadingLink>
  </PublicShell>;
}
