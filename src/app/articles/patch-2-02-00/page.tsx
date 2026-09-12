import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";
import { chartingTheUnknown, patch20200 } from "@/lib/editorialArticles";
import { SITE_NAME, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd } from "@/lib/structuredData";

const [patchNotes, dlcAnnouncement, crossSaveInformation] = patch20200.sources;
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
            <Link className="back-link" href="/news">← Back to the news desk</Link>
            <p className="kicker">Patch 2.02.00 · News</p>
            <h1>{patch20200.title}</h1>
            <p className="article-deck">{patch20200.description}</p>
            <div className="article-meta">
              <time dateTime={patch20200.publishedAt}>September 11, 2026</time>
              <span>Sources: Pearl Abyss</span>
              <a href="#sources">View sources ↓</a>
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
            <figcaption>Official Patch 2.02.00 artwork, courtesy of Pearl Abyss. Illustration, not evidence of a fix.</figcaption>
          </figure>
          <section className="mobile-brief" aria-label="Patch at a glance">
            <p className="eyebrow">At publication · September 11, 2026</p>
            <dl>
              <div><dt>Live</dt><dd>Steam PC and Mac, PlayStation, Xbox, Epic</dd></div>
              <div><dt>Later</dt><dd>Mac App Store · update in progress</dd></div>
              <div><dt>Focus</dt><dd>Mac cross-save and targeted fixes</dd></div>
            </dl>
            <details>
              <summary>Jump to a section</summary>
              <div className="mobile-contents">
                <a href="#mac">Mac cross-save and the store distinction</a>
                <a href="#fixes">Where the fixes matter</a>
                <a href="#support">Support after the reveal</a>
                <a href="#unconfirmed">What is still unconfirmed?</a>
                <a href="#sources">Sources &amp; updates</a>
              </div>
            </details>
          </section>
          <div className="reading-grid">
            <aside className="article-rail" aria-label="Article contents">
              <p className="eyebrow">In this report</p>
              <a href="#mac">Mac cross-save</a>
              <a href="#fixes">Where the fixes matter</a>
              <a href="#support">Support after the reveal</a>
              <a href="#unconfirmed">Still unconfirmed</a>
              <div className="release-note">
                <p className="kicker">The official record</p>
                <strong>2.02.00</strong>
                <span>September 11 · 05:30 UTC</span>
                <a href={patchNotes.url} target="_blank" rel="noreferrer noopener">Read the full patch notes ↗</a>
              </div>
            </aside>
            <div id="article-body" className="article-body">
              <p className="opening">There is plenty to look forward to in <em>Charting the Unknown</em>, and it is good to see Pywel getting attention right now. Eight days after the expansion reveal, Patch 2.02.00 brings Mac cross-save alongside fixes for a startup crash, blocked quests, housing and missing stored items.</p>

              <h2 id="mac">Mac cross-save</h2>
              <p>The <a href={patchNotes.url} target="_blank" rel="noreferrer noopener">September 11 notes</a> add cross-save support on Mac. At publication, the update was available on Steam for PC and Mac, PlayStation, Xbox and Epic Games Store. The Mac App Store update was still in progress, with no release time given.</p>
              <p>The App Store delay concerns this patch. Separately, Pearl Abyss says <em>Charting the Unknown</em> will not be available on the Mac App Store at launch.</p>
              <p>Cross-save lets players continue a save across supported platforms. At the September 11 check, Pearl Abyss’s <a href={crossSaveInformation.url} target="_blank" rel="noreferrer noopener">account information page</a> still said Mac support was coming later, despite the newer patch notes announcing it.</p>

              <h2 id="fixes">Where the fixes matter</h2>
              <p>Pearl Abyss says it fixed a crash when starting a new game with DLSS Frame Generation enabled.</p>
              <p>Several repairs concern progress and possessions: housing failing to unlock at Howling Hill Camp with a full inventory, a blocked Thornbriar Fortress liberation, trade storage losing items on some save loads, and a disappearing letter stopping <em>The Words of Alustin</em>. These are the changes to check first if a save has been stuck.</p>
              <p>The remaining notes cover a palm-attack chain, lantern visibility, shaking interface text, localization including Arabic display, indoor armor noise and a blindfold-related visual issue. The notes do not say whether previously lost items or every already-blocked save will recover automatically.</p>
              <a className="inline-source" href={patchNotes.url} target="_blank" rel="noreferrer noopener">Read every fix and the current platform rollout ↗</a>

              <h2 id="support">Support continues after the reveal</h2>
              <p>On September 3, Pearl Abyss <a href={dlcAnnouncement.url} target="_blank" rel="noreferrer noopener">put the expansion on the calendar</a>: October 15 at 6 pm Eastern, with ships, islands and underwater exploration among its announced features. Our <Link href={chartingTheUnknown.path}>Charting the Unknown report</Link> covers those features.</p>

              <section id="unconfirmed" className="editorial-note" aria-labelledby="unconfirmed-heading">
                <h2 id="unconfirmed-heading">What is still unconfirmed?</h2>
                <p>The Hub has not tested Mac save transfers or verified these fixes on affected saves. The patch notes describe Pearl Abyss’s changes; they do not establish the result on a particular player’s setup.</p>
                <p>If a problem persists, <Link href="/issues">add a check-in to an existing issue</Link> with your experience and platform. The <Link href="/patches">Patch Desk</Link> keeps the current official record alongside player follow-up.</p>
              </section>
              <section id="sources" className="article-sources">
                <h2>Sources &amp; updates</h2>
                <p>{patch20200.sourceNote} Checked September 11, 2026. Platform availability and account-page wording reflect that check. This report retains its original publication date.</p>
                <ol>{patch20200.sources.map((source) => (
                  <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer noopener">{source.label} ↗</a></li>
                ))}</ol>
              </section>
            </div>
          </div>
        </article>
        <div className="article-bottom"><Link href="/news">More from the news desk →</Link><a href="#article-top">Back to top ↑</a></div>
      </div>
    </PublicShell>
  );
}
