import { ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { Metadata } from "next";
import Image from "next/image";
import { PublicShell } from "@/components/dispatch/Chrome";
import { patch20300 } from "@/lib/editorialArticles";
import { SITE_NAME, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import { newsArticleJsonLd, serializeJsonLd } from "@/lib/structuredData";

const [patchNotes, previousPatch, septemberPatch, dlcAnnouncement] = patch20300.sources;
const sections = [
  { id: "weekly", label: "Weekly updates continue" },
  { id: "graphics", label: "The DLSS update" },
  { id: "fixes", label: "Movement and fixes" },
  { id: "sources", label: "Sources & updates" },
];
const shareImage = {
  url: `${SITE_URL}${patch20300.shareImage.src}`,
  width: patch20300.shareImage.width,
  height: patch20300.shareImage.height,
  alt: patch20300.shareImage.alt,
};

export const metadata: Metadata = {
  title: patch20300.searchTitle,
  description: patch20300.description,
  alternates: { canonical: patch20300.path, types: siteFeedAlternateTypes },
  openGraph: {
    type: "article",
    url: patch20300.path,
    siteName: SITE_NAME,
    title: patch20300.searchTitle,
    description: patch20300.description,
    publishedTime: patch20300.publishedAt,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: patch20300.searchTitle,
    description: patch20300.description,
    images: [shareImage],
  },
};

export default function Patch20300Article() {
  return (
    <PublicShell active="news">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(newsArticleJsonLd(patch20300)) }} />
      <div id="article-top">
        <a className="skip" href="#article-body">Skip to article</a>
        <article>
          <div className="article-heading">
            <ReadingLink variant="quiet" direction="back" className="back-link" href="/news">Back to the news desk</ReadingLink>
            <p className="kicker">Patch 2.03.00 · News</p>
            <h1>{patch20300.title}</h1>
            <p className="article-deck">{patch20300.description}</p>
            <div className="article-meta">
              <time dateTime={patch20300.publishedAt}>September 18, 2026</time>
              <span>Sources: Pearl Abyss</span>
              <ReadingLink variant="quiet" direction="down" href="#sources">View sources</ReadingLink>
            </div>
          </div>
          <figure className="article-hero">
            <Image
              src={patch20300.heroImage.src}
              width={patch20300.heroImage.width}
              height={patch20300.heroImage.height}
              alt={patch20300.heroImage.alt}
              sizes="(max-width: 1440px) 100vw, 1384px"
              preload
              style={{ aspectRatio: "923 / 522", objectFit: "contain" }}
            />
            <figcaption>Patch 2.03.00 artwork. Image: Pearl Abyss.</figcaption>
          </figure>
          <section className="mobile-brief" aria-label="Patch at a glance">
            <p className="eyebrow">At publication · September 18, 2026</p>
            <dl>
              <div><dt>Live</dt><dd>Steam PC and Mac, PlayStation, Xbox, Epic</dd></div>
              <div><dt>Later</dt><dd>Mac App Store · update in progress</dd></div>
              <div><dt>Changes</dt><dd>DLSS update, movement and fixes</dd></div>
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
                <strong>2.03.00</strong>
                <span>September 18 · 01:00 UTC</span>
                <ReadingLink variant="source" source="Pearl Abyss" href={patchNotes.url}>Read the full patch notes</ReadingLink>
              </div>
            </aside>
            <div id="article-body" className="article-body">
              <p id="weekly" tabIndex={-1} className="opening">Less than a month until <a href={dlcAnnouncement.url} target="_blank" rel="noreferrer noopener">Charting the Unknown</a>, and Pearl Abyss is still showing the base game some love. <a href={patchNotes.url} target="_blank" rel="noreferrer noopener">Patch 2.03.00</a> keeps September&apos;s weekly run going, with a DLSS update alongside movement changes and fixes.</p>
              <p>That makes three patches in three weeks: <a href={septemberPatch.url} target="_blank" rel="noreferrer noopener">September 4</a>, <a href={previousPatch.url} target="_blank" rel="noreferrer noopener">September 11</a> and now September 18. The expansion arrives October 15 at 6 p.m. Eastern.</p>

              <h2 id="graphics" tabIndex={-1}>The DLSS update</h2>
              <p>Pearl Abyss updated NVIDIA Streamline to 2.14.1, bringing a newer transformer model to DLSS Ray Reconstruction. The notes give no frame-rate figures.</p>
              <p id="unconfirmed">The Hub has not tested these fixes or measured the graphics change. A higher frame rate is still something to verify.</p>

              <h2 id="fixes" tabIndex={-1}>Movement and fixes</h2>
              <p>Photo Mode gains finer camera control. Water Stride adds jumping and, with Vaporwalker equipped, sliding.</p>
              <p>Listed fixes address lost character control during <em>Investigate the mysterious voice</em>, freezes when using certain items while mounted, and combat dispatch missions canceled after saving and loading.</p>
              <p>Other fixes target excessive fall damage when leaving A.T.A.G. midair and enemies failing to fall from cliffs after knockback in certain situations.</p>
              <p>At publication, Steam PC and Mac, PlayStation, Xbox and Epic had the update. The Mac App Store release remained pending.</p>
              <section id="sources" tabIndex={-1} className="article-sources">
                <h2>Sources &amp; updates</h2>
                <p>{patch20300.sourceNote} Checked September 18, 2026. Platform availability reflects that check.</p>
                <ol>{patch20300.sources.map((source) => (
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
