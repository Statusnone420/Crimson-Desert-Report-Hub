import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import Link from "next/link";
import Image from "next/image";
import { PublicShell } from "@/components/dispatch/Chrome";
import { HomeNumbers } from "@/components/newspaper/HomeNumbers";
import { FrontPageReports } from "@/components/newspaper/FrontPageReports";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { needsFullIssueCard } from "@/lib/evidence";
import { CATEGORY_LABELS } from "@/lib/constants";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";

export const revalidate = 300;
// The 16:9 source must cover the full portrait-frame height before cropping.
const storyImageSizes = "(max-width:650px) 100vw, (max-width:1000px) 42vw, 430px";
export default async function HomePage() {
  const [data, scanner, radar] = await Promise.all([getDashboardData(), getPublicScannerData(), getPatchRadarData()]);
  const patch = data.currentPatch;
  const patchUnverified = patch.source === "fallback";
  const issues = data.topClusters.filter(needsFullIssueCard);
  const publishedCount = data.evidenceUnavailable || data.publicLeadsUnavailable || data.checkinsAvailable === false ? null : issues.length;
  const claims = data.claimsUnavailable ? [] : data.claimedFixes.slice(0,2);
  return <PublicShell active="brief" masthead><script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(webSiteJsonLd())}}/>
    <FrontPageReports />
    <PublicationFeed />
    {patchUnverified && <p className="np-error" role="status">The current patch could not be verified.</p>}
    <section className="stories" id="patches">{claims.map((claim,index) => <article key={claim.fixText}><div className={`story-image ${index === 0 ? 'quest' : 'combat'}`}><Image loading="eager" src={index === 0 ? '/official/content.jpg' : '/official/combat.jpg'} width={1920} height={1080} sizes={storyImageSizes} alt={index === 0 ? 'An adventurer overlooking a riverside settlement' : 'Two fighters in a stone courtyard'}/></div><div><p className="kicker">{claim.section || (claim.category && CATEGORY_LABELS[claim.category as keyof typeof CATEGORY_LABELS]) || 'Official notes'}</p><h2 className="story-title"><Link href="/patches#claims">{claim.fixText}</Link></h2><p>{patchUnverified ? 'Listed in the official notes.' : `Listed in the official notes for ${patch.version}.`}</p><ReadingLink className="action" href="/patches#claims">Browse the fix record</ReadingLink></div></article>)}{claims.length===0 && <article><div><p className="kicker">The patch desk</p><h2 className="story-title">{data.claimsUnavailable ? 'Official claims are unavailable.' : 'The official record.'}</h2><p>{data.claimsUnavailable ? 'The claims read did not complete. No count is assumed to be zero.' : patchUnverified ? 'No claimed fixes were returned.' : 'No claimed fixes are recorded for this patch yet.'}</p><ReadingLink className="action" href="/patches">Read the patch desk</ReadingLink></div></article>}<aside id="board"><p className="kicker">Community record</p><h2>{publishedCount === null ? 'Issue counts unavailable' : `${publishedCount} tracked ${publishedCount === 1 ? 'issue' : 'issues'}`}</h2><p className="small">See what people are experiencing on this patch. Add a quick check-in to an existing issue.</p><dl><div><dt>Published issues</dt><dd>{publishedCount ?? 'Unavailable'}</dd></div><div><dt>Tracked leads</dt><dd>{radar.connected ? radar.recurring.trackedLeads : 'Unavailable'}</dd></div><div><dt>Claimed fixes</dt><dd>{data.claimsUnavailable ? 'Unavailable' : data.claimedFixes.length}</dd></div></dl><div className="report-actions"><ReadingLink className="action" href="/issues">{publishedCount === null ? "Read the issue board" : `All ${publishedCount} published ${publishedCount === 1 ? "issue" : "issues"}`}</ReadingLink><ReadingLink variant="quiet" className="chart-link" href="/issues#board">Add a check-in</ReadingLink></div></aside></section>
    <HomeNumbers steam={scanner.steamPulse} steamUnavailable={scanner.pulseReadFailures.includes('steam')} radar={radar.connected ? radar : null}/>
    <PublicationFeed type="video" />
    <ReadingLink variant="quiet" className="chart-link" href="/watch">More videos</ReadingLink>
  </PublicShell>;
}
