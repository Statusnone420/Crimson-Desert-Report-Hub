import { PublicationFeed } from "@/components/newspaper/PublicationFeed";
import Link from "next/link";
import Image from "next/image";
import { PublicShell } from "@/components/dispatch/Chrome";
import { HomeNumbers } from "@/components/newspaper/HomeNumbers";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { needsFullIssueCard } from "@/lib/evidence";
import { CATEGORY_LABELS } from "@/lib/constants";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";

export const revalidate = 300;
const articlePublishedAt = "2026-09-05T00:00:00Z";
// The 16:9 source must cover the full portrait-frame height before cropping.
const storyImageSizes = "(max-width:650px) 383px, (max-width:1000px) 463px, 587px";
export default async function HomePage() {
  const [data, scanner, radar] = await Promise.all([getDashboardData(), getPublicScannerData(), getPatchRadarData()]);
  const patch = data.currentPatch;
  const issues = data.topClusters.filter(needsFullIssueCard);
  const publishedCount = data.evidenceUnavailable || data.publicLeadsUnavailable ? null : issues.length;
  const featureAvailable = new Date().getTime() >= Date.parse(articlePublishedAt);
  const claims = data.claimsUnavailable ? [] : data.claimedFixes.slice(0,2);
  return <PublicShell active="brief" masthead><script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(webSiteJsonLd())}}/>
    <section id="lead" className="lead"><figure><Image src="/official/coast.jpg" width={1920} height={1180} priority sizes="(max-width:650px) 100vw, 60vw" alt="A rider overlooking the sea, rocky islands and a sailing ship"/><figcaption>Pywel coastline · Image: Pearl Abyss</figcaption></figure><div className="lead-copy"><p className="kicker">{featureAvailable ? "Expansion · October 15" : "The patch record"}</p><Link className="headline" href={featureAvailable ? "/articles/charting-the-unknown" : "/patches"}>{featureAvailable ? <>Beyond Pywel’s <br/>familiar shores</> : patch.source === "fallback" ? "The current patch could not be verified." : `Patch ${patch.version}: the official fixes and player record.`}</Link><div className="short-rule"/><p className="dek">{featureAvailable ? "Charting the Unknown arrives October 15. Here’s what Pearl Abyss has confirmed about the next adventure." : "The official notes, the claimed fixes and the questions players are asking."}</p>{featureAvailable && <time className="np-date" dateTime={articlePublishedAt}>Published September 5, 2026</time>}<Link className="action" href={featureAvailable ? "/articles/charting-the-unknown" : "/patches"}>{featureAvailable ? "Read the expansion report" : "Read the patch record"} →</Link></div></section>
    <PublicationFeed />
    <Link className="chart-link" href="/news">More from the news desk →</Link>
    <section className="stories" id="patches">{claims.map((claim,index) => <article key={claim.fixText}><div className={`story-image ${index === 0 ? 'quest' : 'combat'}`}><Image loading="eager" src={index === 0 ? '/official/content.jpg' : '/official/combat.jpg'} width={1920} height={1080} sizes={storyImageSizes} alt={index === 0 ? 'An adventurer overlooking a riverside settlement' : 'Two fighters in a stone courtyard'}/></div><div><p className="kicker">{claim.section || (claim.category && CATEGORY_LABELS[claim.category as keyof typeof CATEGORY_LABELS]) || 'Official notes'}</p><Link className="story-title" href="/patches#claims">{claim.fixText}</Link><p>Listed in the official notes for {patch.version}.</p><Link className="action" href="/patches#claims">Browse the fix record →</Link></div></article>)}{claims.length===0 && <article><div><p className="kicker">The patch desk</p><h2 className="story-title">{data.claimsUnavailable ? 'Official claims are unavailable.' : 'The official record.'}</h2><p>{data.claimsUnavailable ? 'The claims read did not complete. No count is assumed to be zero.' : 'No claimed fixes are recorded for this patch yet.'}</p><Link className="action" href="/patches">Read the patch desk →</Link></div></article>}<aside id="board"><p className="kicker">Player reports</p><h2>{data.evidenceUnavailable ? 'Report counts unavailable' : `${data.total} ${data.total === 1 ? 'report' : 'reports'} this patch`}</h2><p className="small">Individual reports stay on the issue board. Publication does not automatically make a homepage headline.</p><dl><div><dt>Published issues</dt><dd>{publishedCount ?? 'Unavailable'}</dd></div><div><dt>Tracked leads</dt><dd>{radar.connected ? radar.recurring.trackedLeads : 'Unavailable'}</dd></div><div><dt>Claimed fixes</dt><dd>{data.claimsUnavailable ? 'Unavailable' : data.claimedFixes.length}</dd></div></dl><Link className="action" href="/issues">{publishedCount === null ? 'Read the issue board →' : `All ${publishedCount} published ${publishedCount === 1 ? 'issue' : 'issues'} →`}</Link><Link className="chart-link" href="/report">File a report →</Link></aside></section>
    <HomeNumbers steam={scanner.steamPulse} steamUnavailable={scanner.pulseReadFailures.includes('steam')} radar={radar.connected ? radar : null}/>
    <PublicationFeed type="video" />
  </PublicShell>;
}
