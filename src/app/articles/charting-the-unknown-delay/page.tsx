import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { chartingTheUnknownDelay as report } from "@/lib/editorialArticles";
import { SITE_NAME, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd } from "@/lib/structuredData";

const [delayNotice, preorderNotice, , overview] = report.sources;
const sections = [
  { id: "delay", label: "Why the date moved" },
  { id: "schedule", label: "The revised launch schedule" },
  { id: "expansion", label: "What we’re waiting for" },
  { id: "editorial-opinion", label: "Editorial opinion" },
  { id: "sources", label: "Sources & dates" },
];
const shareImage = { url: `${SITE_URL}${report.shareImage.src}`, width: report.shareImage.width, height: report.shareImage.height, alt: report.shareImage.alt };

export const metadata: Metadata = {
  title: report.searchTitle,
  description: report.description,
  alternates: { canonical: report.path, types: siteFeedAlternateTypes },
  openGraph: {
    type: "article", url: report.path, siteName: SITE_NAME,
    title: report.searchTitle, description: report.description,
    publishedTime: report.publishedAt, images: [shareImage],
  },
  twitter: { card: "summary_large_image", title: report.searchTitle, description: report.description, images: [shareImage] },
};

export default function ExpansionDelayArticle() {
  return (
    <PublicShell active="news">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(newsArticleJsonLd(report)) }} />
      <div id="article-top">
        <a className="skip" href="#article-body">Skip to article</a>
        <article>
          <div className="article-heading">
            <ReadingLink variant="quiet" direction="back" className="back-link" href="/news">Back to the news desk</ReadingLink>
            <p className="kicker">Expansion news · Editorial opinion below</p>
            <h1>{report.title}</h1>
            <p className="article-deck">{report.description}</p>
            <div className="article-meta">
              <time dateTime={report.publishedAt}>September 30, 2026</time>
              <span>Sources: Pearl Abyss</span>
              <ReadingLink variant="quiet" direction="down" href="#sources">View sources</ReadingLink>
            </div>
          </div>
          <figure className="article-hero">
            <Image {...report.heroImage} alt={report.heroImage.alt} sizes="(max-width: 1440px) 100vw, 1384px" preload style={{ aspectRatio: "16 / 9", objectFit: "contain" }} />
            <figcaption>Official release-date announcement. Image © Pearl Abyss. This is an independent, unofficial fan report.</figcaption>
          </figure>
          <section className="mobile-brief" aria-label="Delay at a glance">
            <p className="eyebrow">The revised schedule</p>
            <dl>
              <div><dt>New date</dt><dd>October 29, 2026</dd></div>
              <div><dt>Time</dt><dd>22:00 UTC · 6 p.m. Eastern</dd></div>
              <div><dt>Delay</dt><dd>Two weeks</dd></div>
            </dl>
            <details><summary>Jump to a section</summary><div className="mobile-contents"><SectionNavigation sections={sections} label="In this report" variant="rail" /></div></details>
          </section>
          <div className="reading-grid">
            <aside className="article-rail" aria-label="Article contents">
              <SectionNavigation sections={sections} label="In this report" variant="rail" />
              <div className="release-note">
                <p className="kicker">Revised release date</p>
                <strong>29 October</strong>
                <span>2026 · 6 p.m. Eastern</span>
                <ReadingLink variant="source" source="Pearl Abyss" href={delayNotice.url}>Official delay announcement</ReadingLink>
              </div>
            </aside>
            <div id="article-body" className="article-body">
              <p className="opening">Crimson Desert’s <em>Charting the Unknown</em> expansion has been delayed by two weeks, moving from October 15 to October 29, 2026. Pearl Abyss says it needs more development time for a more polished and stable gameplay experience.</p>
              <p>The <a href={delayNotice.url} target="_blank" rel="noreferrer noopener">September 30 announcement</a> sets the new launch at 22:00 UTC, or 6 p.m. Eastern. Pearl Abyss has also revised its <a href={preorderNotice.url} target="_blank" rel="noreferrer noopener">September 3 pre-order notice</a> to carry the October 29 schedule.</p>

              <h2 id="delay" tabIndex={-1}>Why the date moved</h2>
              <p>In its message to players, the Crimson Desert team says it has “determined that we need additional development time to deliver a more polished and stable gameplay experience.” It apologizes for the longer wait and says it will use the extra time to further refine the content.</p>
              <p>The statement does not identify a particular feature or bug behind the decision. It gives a reason for the delay and a new date, without a detailed breakdown of the remaining work.</p>

              <h2 id="schedule" tabIndex={-1}>The revised launch schedule</h2>
              <p>The announced release is Thursday, October 29 at 22:00 UTC. That is 3 p.m. Pacific and 6 p.m. in New York on the same day. In South Korea and Japan, the listed time is 7 a.m. on Friday, October 30.</p>
              <p>The revised pre-order notice still says the expansion will not be available on the Mac App Store at launch. Pearl Abyss says it will make a separate announcement if a future release there is planned.</p>
              <p>That notice also carries a market-availability update: the DLC will be unavailable in certain markets or regions following a review of content and age-rating requirements. It does not name those markets. For affected pre-orders, Pearl Abyss says refunds may be automatic or may require a request through the platform’s usual process.</p>

              <h2 id="expansion" tabIndex={-1}>What we’re waiting for</h2>
              <p>Pearl Abyss’s <a href={overview.url} target="_blank" rel="noreferrer noopener">expansion overview</a> describes ship travel to offshore islands and underwater exploration, including sunken ruins and treasure. On land, it lists upgraded housing and facilities that players can rent and manage.</p>
              <p>The overview also describes new stories for Kliff, Oongka and Damiane, with threats across land and sea. Those are the developer’s announced features; today’s delay notice focuses on the extra time needed to prepare the release.</p>
              <p>The Hub’s <Link href="/articles/charting-the-unknown">original expansion report</Link> covers that announcement in more detail. It retains its September 5 publication date and the schedule reported at the time.</p>

              <section aria-labelledby="editorial-opinion">
                <h2 id="editorial-opinion" tabIndex={-1}>Editorial opinion: the wait stinks, but I’m happy to give them the time</h2>
                <p>The delay stinks. I’m disappointed we have to wait another two weeks, but I’m glad the team is taking the time it needs to get this right.</p>
                <p>I want this expansion to be as good as it can be. I still trust the development team to give us the best experience they can, and I’m happy to give them that extra time.</p>
              </section>

              <section id="sources" tabIndex={-1} className="article-sources">
                <h2>Sources &amp; dates</h2>
                <p>Official sources checked September 30, 2026. The release-date notice is dated September 30 at 10:20 UTC. The pre-order notice retains its September 3 publication date and is marked revised September 30. The Hub’s publication date appears above.</p>
                <ol>{report.sources.map((source) => <li key={source.url}><ReadingLink variant="source" source={new URL(source.url).hostname} href={source.url}>{source.label}</ReadingLink></li>)}</ol>
                <p>Announcement artwork used under Pearl Abyss’s <a href="https://crimsondesert.pearlabyss.com/en-US/Policy?_policyNo=130" target="_blank" rel="noreferrer noopener">Fan Content Guidelines</a>. This report is not endorsed by Pearl Abyss.</p>
              </section>
            </div>
          </div>
        </article>
        <div className="article-bottom"><ReadingLink href="/news">More from the news desk</ReadingLink><ReadingLink variant="quiet" direction="up" href="#article-top">Back to top</ReadingLink></div>
      </div>
    </PublicShell>
  );
}
