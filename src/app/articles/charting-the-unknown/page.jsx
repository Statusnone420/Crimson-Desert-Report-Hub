import { ReadingLink, DirectionIcon } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import Link from 'next/link';
import Image from 'next/image';
import { PublicShell } from '@/components/dispatch/Chrome';
import { chartingTheUnknown } from '@/lib/editorialArticles';
import { SITE_NAME, siteFeedAlternateTypes } from '@/lib/site';
import { newsArticleJsonLd, serializeJsonLd } from '@/lib/structuredData';
import ReadingMotion from './reading-motion';

const [releaseNotice, expansionOverview] = chartingTheUnknown.sources;
const notice = releaseNotice.url;
const dlc = expansionOverview.url;
const sections = [
  { id: 'ocean', label: 'Ships and underwater exploration' },
  { id: 'home', label: 'Housing and facilities' },
  { id: 'launch', label: 'Launch times and platforms' },
  { id: 'watch', label: 'Trailer and commentary' },
  { id: 'sources', label: 'Sources & updates' },
];

export const metadata = {
  title: chartingTheUnknown.searchTitle,
  description: chartingTheUnknown.description,
  alternates: { canonical: chartingTheUnknown.path, types: siteFeedAlternateTypes },
  openGraph: {
    type: 'article',
    url: chartingTheUnknown.path,
    siteName: SITE_NAME,
    title: chartingTheUnknown.searchTitle,
    description: chartingTheUnknown.description,
    publishedTime: chartingTheUnknown.publishedAt,
    images: [{
      url: chartingTheUnknown.heroImage.src,
      width: chartingTheUnknown.heroImage.width,
      height: chartingTheUnknown.heroImage.height,
      alt: chartingTheUnknown.heroImage.alt,
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: chartingTheUnknown.searchTitle,
    description: chartingTheUnknown.description,
    images: [chartingTheUnknown.heroImage.src],
  },
};

export default function ExpansionArticle() {
  return (
    <PublicShell active="brief"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(newsArticleJsonLd(chartingTheUnknown))}}/><div id="main-top">
      <a className="skip" href="#article-body">Skip to article</a>
      <ReadingMotion />
      <article>
        <div className="article-heading">
          <ReadingLink variant="quiet" direction="back" className="back-link" href="/"> Back to the front page</ReadingLink>
          <p className="kicker">The expansion · News</p>
          <h1>{chartingTheUnknown.title}</h1>
          <p className="article-deck">{chartingTheUnknown.description}</p>
          <div className="article-meta"><time dateTime={chartingTheUnknown.publishedAt}>September 5, 2026</time><span>Sources: Pearl Abyss</span><ReadingLink variant="quiet" direction="down" href="#sources">View sources</ReadingLink></div>
        </div>
        <figure className="article-hero">
          <div className="coast-crop"><Image src={chartingTheUnknown.heroImage.src} width={chartingTheUnknown.heroImage.width} height={chartingTheUnknown.heroImage.height} priority sizes="(max-width:1440px) 100vw, 1384px" alt={chartingTheUnknown.heroImage.alt} /></div>
          <figcaption>Pywel coastline · Official base-game image, courtesy of Pearl Abyss.</figcaption>
        </figure>
        <section className="mobile-brief" aria-label="Three key facts">
          <p className="eyebrow">The short version</p>
          <dl><div><dt>When</dt><dd>October 15 · 6 p.m. Eastern</dd></div><div><dt>Explore</dt><dd>New islands and underwater ruins</dd></div><div><dt>Build</dt><dd>Expanded housing and facilities</dd></div></dl>
          <details><summary>Jump to a section</summary><div className="mobile-contents"><SectionNavigation sections={sections} label="In this report" variant="rail" /></div></details>
        </section>
        <div className="reading-grid">
          <aside className="article-rail" aria-label="Article contents">
            <SectionNavigation sections={sections} label="In this report" variant="rail" />
            <div className="release-note"><p className="kicker">Release date</p><strong>15 October</strong><span>2026 · 6 p.m. Eastern</span><ReadingLink variant="source" source="Pearl Abyss" href={notice}>Official announcement</ReadingLink></div>
          </aside>
          <div id="article-body" className="article-body">
            <p className="opening">Crimson Desert’s <em>Charting the Unknown</em> expansion launches October 15, 2026, at 6 p.m. Eastern. Pearl Abyss’s <a href={notice} target="_blank" rel="noreferrer">September 3 announcement</a> sets the date, while its <a href={dlc} target="_blank" rel="noreferrer">feature overview</a> describes ships, underwater exploration and housing changes.</p>
            <h2 id="ocean" tabIndex={-1}>Ships and underwater exploration</h2>
            <p>The overview says players can command a ship, visit islands off Pywel’s coast and dive for treasure and sunken ruins. It also lists new enemies on land and at sea.</p>
            <p>New stories follow Kliff, Oongka and Damiane. Pearl Abyss describes political conflict, a presence in the desert and an ancient secret beneath the sea.</p>
            <h2 id="home" tabIndex={-1}>Housing and facilities</h2>
            <p>The expansion includes an upgraded Housing mode and facilities that players can rent and manage. Pearl Abyss also describes deeper relationships with Pywel’s inhabitants.</p>
            <h2 id="launch" tabIndex={-1}>Launch times and platforms</h2>
            <p>The launch is at 10 p.m. UTC on October 15, or 7 a.m. on October 16 in Korea and Japan. The Mac App Store version will not be available at launch. Pearl Abyss says it will make a separate announcement if a Mac release is planned.</p>
            <p>Pre-orders include the Charter’s Diving Set for Kliff and Oongka and the Charter’s Light Diving Set for Damiane.</p>
            <p>At the September 5 check, the linked pages did not specify the expansion’s length, download size or progression requirements.</p>
            <section id="watch" tabIndex={-1} className="watch-section">
              <p className="kicker">Watch</p><h2>Official trailer and creator commentary</h2>
              <a className="video-link" href="https://www.youtube.com/watch?v=HaCtG1F_hfE" target="_blank" rel="noreferrer"><span className="video-category">Official · Crimson Desert</span><strong>Charting the Unknown — reveal trailer</strong><span>Watch on YouTube <DirectionIcon direction="external" /></span></a>
              <a className="video-link" href="https://www.youtube.com/watch?v=Mhl-PhkWPEw" target="_blank" rel="noreferrer"><span className="video-category">Creator spotlight · jayvee</span><strong>Crimson Desert’s New DLC Looks Insane</strong><span>Video by jayvee · Watch on YouTube <DirectionIcon direction="external" /></span></a>
            </section>
            <section id="sources" tabIndex={-1} className="article-sources"><h2>Sources &amp; updates</h2><p>{chartingTheUnknown.sourceNote} Checked September 5, 2026. This report retains its original publication date.</p><ol>{chartingTheUnknown.sources.map((source) => <li key={source.url}><ReadingLink variant="source" source={new URL(source.url).hostname} href={source.url}>{source.label}</ReadingLink></li>)}</ol></section>
          </div>
        </div>
      </article>
      <section className="related-stories"><p className="kicker">Keep reading</p><h2>Current patch coverage</h2><div><Link href="/patches"><Image src="/official/combat.jpg" width={1920} height={1080} sizes="200px" alt="Two armored fighters clashing in a stone courtyard"/><span><small>Patch coverage</small><strong>Official fixes and community check-ins</strong><span>Return to the patch desk <DirectionIcon /></span></span></Link><Link href="/observatory"><span><small>The Observatory</small><strong>The game in numbers</strong><span>Explore review movement and tracked leads <DirectionIcon /></span></span></Link></div></section>
      <div className="article-bottom"><ReadingLink variant="quiet" direction="back" href="/"> Crimson Desert Report Hub</ReadingLink><ReadingLink variant="quiet" direction="up" href="#main-top">Back to top</ReadingLink></div>
    </div></PublicShell>
  );
}
