import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { Metadata } from "next";
import Image from "next/image";
import { PublicShell } from "@/components/dispatch/Chrome";
import { patch20200 } from "@/lib/editorialArticles";
import { SITE_NAME, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd } from "@/lib/structuredData";

const [patchNotes, dlcAnnouncement, crossSaveInformation] = patch20200.sources;
const sections = [
  { id: "mac", label: "Mac cross-save" },
  { id: "fixes", label: "Quest and storage fixes" },
  { id: "sources", label: "Sources & updates" },
];
const shareImage = {
  url: `${SITE_URL}${patch20200.shareImage.src}`,
  width: patch20200.shareImage.width,
  height: patch20200.shareImage.height,
  alt: patch20200.shareImage.alt,
};

export const metadata: Metadata = {
  title: patch20200.searchTitle,
  description: patch20200.description,
  alternates: { canonical: patch20200.path, types: siteFeedAlternateTypes },
  openGraph: {
    type: "article",
    url: patch20200.path,
    siteName: SITE_NAME,
    title: patch20200.searchTitle,
    description: patch20200.description,
    publishedTime: patch20200.publishedAt,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: patch20200.searchTitle,
    description: patch20200.description,
    images: [shareImage],
  },
};

export default function Patch20200Article() {
  return (
    <PublicShell active="news">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(newsArticleJsonLd(patch20200)) }} />
      <div id="article-top">
        <a className="skip" href="#article-body">Skip to article</a>
        <article>
          <div className="article-heading">
            <ReadingLink variant="quiet" direction="back" className="back-link" href="/news">Back to the news desk</ReadingLink>
            <p className="kicker">Patch 2.02.00 · News</p>
            <h1>{patch20200.title}</h1>
            <p className="article-deck">{patch20200.description}</p>
            <div className="article-meta">
              <time dateTime={patch20200.publishedAt}>September 11, 2026</time>
              <span>Sources: Pearl Abyss</span>
              <ReadingLink variant="quiet" direction="down" href="#sources">View sources</ReadingLink>
            </div>
          </div>
          <figure className="article-hero">
            <Image
              src={patch20200.heroImage.src}
              width={patch20200.heroImage.width}
              height={patch20200.heroImage.height}
              alt={patch20200.heroImage.alt}
              sizes="(max-width: 1440px) 100vw, 1384px"
              priority
              style={{ aspectRatio: "923 / 522", objectFit: "contain" }}
            />
            <figcaption>Patch 2.02.00 artwork. Image: Pearl Abyss.</figcaption>
          </figure>
          <section className="mobile-brief" aria-label="Patch at a glance">
            <p className="eyebrow">At publication · September 11, 2026</p>
            <dl>
              <div><dt>Live</dt><dd>Steam PC and Mac, PlayStation, Xbox, Epic</dd></div>
              <div><dt>Later</dt><dd>Mac App Store · update in progress</dd></div>
              <div><dt>Changes</dt><dd>Mac cross-save, quest and storage fixes</dd></div>
            </dl>
            <details>
              <summary>Jump to a section</summary>
              <div className="mobile-contents">
                <SectionNavigation sections={sections} label="In this report" variant="rail" />
              </div>
            </details>
          </section>
          <div className="reading-grid">
            <aside className="article-rail" aria-label="Article contents">
              <SectionNavigation sections={sections} label="In this report" variant="rail" />
              <div className="release-note">
                <p className="kicker">The official record</p>
                <strong>2.02.00</strong>
                <span>September 11 · 05:30 UTC</span>
                <ReadingLink variant="source" source="Pearl Abyss" href={patchNotes.url}>Read the full patch notes</ReadingLink>
              </div>
            </aside>
            <div id="article-body" className="article-body">
              <p id="mac" tabIndex={-1} className="opening">After announcing the DLC we wanted but didn&apos;t know was coming, Pearl Abyss is still showing Crimson Desert&apos;s base game some love. Patch 2.02.00 adds Mac cross-save, with fixes for quests, missing items and a startup crash.</p>
              <p>The <a href={patchNotes.url} target="_blank" rel="noreferrer noopener">September 11 patch notes</a> include a fix for a crash when starting a new game with DLSS Frame Generation enabled.</p>
              <p>At publication, the patch was available on Steam for PC and Mac, PlayStation, Xbox and Epic. Mac App Store players were still waiting, with no release time announced.</p>
              <p>Pearl Abyss&apos;s <a href={crossSaveInformation.url} target="_blank" rel="noreferrer noopener">cross-save guide</a> still listed Mac support as coming later at the September 11 check. That conflicted with the patch announcement.</p>

              <h2 id="fixes" tabIndex={-1}>Quest and storage fixes</h2>
              <p>Pearl Abyss lists fixes for two progression bugs: one prevented players from liberating Thornbriar Fortress, and another made a letter disappear during <em>The Words of Alustin</em>.</p>
              <p>Raising the banner at Howling Hill Camp with a full inventory could also stop housing from unlocking. The notes include a fix for that bug and for items disappearing from Trade Goods Storage when loading certain saves.</p>
              <p>Other changes address a Force Palm combo, lantern visibility, shaking UI text and localization, including Arabic. The notes also list fixes for visual noise on armor indoors and Kliff&apos;s appearance with the Crow Cloth Blindfold when certain settings were enabled.</p>
              <p id="unconfirmed">The notes do not say whether previously lost items return or whether every already-blocked save recovers. The Hub has not tested Mac transfers or these fixes on affected saves.</p>
              <p id="support"><a href={dlcAnnouncement.url} target="_blank" rel="noreferrer noopener">Charting the Unknown</a> launches October 15, 2026, at 6 p.m. Eastern. Pearl Abyss says the expansion will not be available through the Mac App Store at launch.</p>
              <section id="sources" tabIndex={-1} className="article-sources">
                <h2>Sources &amp; updates</h2>
                <p>{patch20200.sourceNote} Checked September 11, 2026. Platform availability and account-page wording reflect that check. This report retains its original publication date.</p>
                <ol>{patch20200.sources.map((source) => (
                  <li key={source.url}><ReadingLink variant="source" source={new URL(source.url).hostname} href={source.url}>{source.label}</ReadingLink></li>
                ))}</ol>
              </section>
            </div>
          </div>
        </article>
        <div className="article-bottom"><ReadingLink href="/news">More from the news desk</ReadingLink><ReadingLink variant="quiet" direction="up" href="#article-top">Back to top</ReadingLink></div>
      </div>
    </PublicShell>
  );
}
