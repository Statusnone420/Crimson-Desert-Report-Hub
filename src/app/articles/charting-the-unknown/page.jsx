import Link from 'next/link';
import Image from 'next/image';
import { PublicShell } from '@/components/dispatch/Chrome';
import ReadingMotion from './reading-motion';

const notice = 'https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=129';
const dlc = 'https://crimsondesert.pearlabyss.com/en-us/Game/DLC/charting-the-unknown';
export const metadata = {title:'Charting the Unknown arrives October 15 — Report Hub'};

export default function ExpansionArticle() {
  return (
    <PublicShell active="brief"><div id="main-top">
      <a className="skip" href="#article-body">Skip to article</a>
      <ReadingMotion />
      <article>
        <div className="article-heading">
          <Link className="back-link" href="/">← Back to the front page</Link>
          <p className="kicker">The expansion · News</p>
          <h1>Beyond Pywel’s familiar shores</h1>
          <p className="article-deck"><span className="desktop-deck">Charting the Unknown arrives October 15, bringing ships, underwater exploration and new ways to make a home in Crimson Desert.</span><span className="mobile-deck">Ships, sunken ruins and a new life in Pywel. The expansion arrives October 15.</span></p>
          <div className="article-meta"><time dateTime="2026-09-05">September 5, 2026</time><span>Sources: Pearl Abyss</span><a href="#sources">View sources ↓</a></div>
        </div>
        <figure className="article-hero">
          <Image src="/official/coast.jpg" width={1920} height={1180} priority sizes="(max-width:1440px) 100vw, 1384px" alt="A rider overlooking the sea, rocky islands and a sailing ship" />
          <figcaption>Pywel coastline · Official base-game image, courtesy of Pearl Abyss.</figcaption>
        </figure>
        <section className="mobile-brief" aria-label="Three key facts">
          <p className="eyebrow">The short version</p>
          <dl><div><dt>When</dt><dd>October 15 · 6 pm Eastern</dd></div><div><dt>Explore</dt><dd>New islands and underwater ruins</dd></div><div><dt>Build</dt><dd>Expanded housing and facilities</dd></div></dl>
          <details><summary>Jump to a section</summary><div className="mobile-contents"><a href="#ocean">Beyond the coastline</a><a href="#home">Life on land</a><a href="#launch">The release date</a><a href="#watch">Trailer &amp; creator coverage</a><a href="#sources">Sources &amp; updates</a></div></details>
        </section>
        <div className="reading-grid">
          <aside className="article-rail" aria-label="Article contents">
            <p className="eyebrow">In this report</p>
            <a href="#ocean">Beyond the coastline</a><a href="#home">Life on land</a><a href="#launch">The release date</a><a href="#watch">Watch the reveal</a>
            <div className="release-note"><p className="kicker">Release date</p><strong>15 October</strong><span>2026 · 6 pm Eastern</span><a href={notice} target="_blank" rel="noreferrer">Official announcement ↗</a></div>
          </aside>
          <div id="article-body" className="article-body">
            <p className="opening">Crimson Desert’s next journey reaches beyond its familiar coastline. Pearl Abyss has announced <em>Charting the Unknown</em>, an expansion arriving on October 15 with new places to explore and more ways to live in Pywel.</p>
            <h2 id="ocean">Beyond the coastline</h2>
            <p>The official DLC page describes commanding a ship, visiting offshore islands and diving for underwater treasures and sunken ruins. New threats await on both land and sea.</p>
            <p>Kliff, Oongka and Damiane also return in new stories. Pearl Abyss points to political conflict, a presence in the desert and mysteries beneath the waves. The announcement offers a first outline rather than a complete account of the expansion.</p>
            <h2 id="home">A different kind of adventure at home</h2>
            <p>Exploration is only part of the reveal. An upgraded Housing mode, facilities to rent and manage, and deeper relationships with Pywel’s inhabitants are also listed on the official site.</p>
            <a className="inline-source" href={dlc} target="_blank" rel="noreferrer">Explore Pearl Abyss’s feature overview ↗</a>
            <h2 id="launch">When can you play?</h2>
            <p>The published schedule puts launch at 6 pm Eastern on October 15, or 10 pm UTC. In Korea and Japan, that is 7 am on October 16. Pearl Abyss says the Mac App Store version will not be available at launch; a future Mac release would require a separate announcement.</p>
            <p>Pre-order bonuses include diving outfits for the three protagonists. The official notice provides the regional schedule and store rollout details.</p>
            <div className="editorial-note desktop-support"><strong>What we’re still waiting to learn</strong><p>The sources linked here do not establish the expansion’s length, download size or progression requirements. Those details should be checked before launch.</p></div>
            <details className="mobile-support"><summary>What is still unconfirmed?</summary><p>The linked sources do not establish the expansion’s length, download size or progression requirements.</p></details>
            <section id="watch" className="watch-section">
              <p className="kicker">Watch</p><h2>The reveal, then a creator’s take</h2>
              <p>Start with the official trailer. For an independent reaction, follow the creator link below. Creator commentary is separate from the confirmed details in this report.</p>
              <a className="video-link" href="https://www.youtube.com/watch?v=HaCtG1F_hfE" target="_blank" rel="noreferrer"><span className="video-category">Official · Crimson Desert</span><strong>Charting the Unknown — reveal trailer</strong><span>Watch on YouTube ↗</span></a>
              <a className="video-link" href="https://www.youtube.com/watch?v=Mhl-PhkWPEw" target="_blank" rel="noreferrer"><span className="video-category">Creator spotlight · jayvee</span><strong>Crimson Desert’s New DLC Looks Insane</strong><span>Video by jayvee · Watch on YouTube ↗</span></a>
            </section>
            <section id="sources" className="article-sources"><h2>Sources &amp; updates</h2><p>Based on Pearl Abyss’s September 3 announcement and official DLC overview. Checked September 5, 2026. This report retains its original publication date.</p><ol><li><a href={notice} target="_blank" rel="noreferrer">Pearl Abyss — pre-orders and release times ↗</a></li><li><a href={dlc} target="_blank" rel="noreferrer">Pearl Abyss — Charting the Unknown overview ↗</a></li></ol></section>
          </div>
        </div>
      </article>
      <section className="related-stories"><p className="kicker">Keep reading</p><h2>Back in the current patch</h2><div><Link href="/patches"><Image src="/official/combat.jpg" width={1920} height={1080} sizes="200px" alt="Two armored fighters clashing in a stone courtyard"/><span><small>Patch coverage</small><strong>Combat and quest changes in the current patch</strong><span>Return to the patch desk →</span></span></Link><Link href="/observatory"><span><small>The Observatory</small><strong>The game in numbers</strong><span>Explore review movement and tracked leads →</span></span></Link></div></section>
      <div className="article-bottom"><Link href="/">← Crimson Desert Report Hub</Link><a href="#main-top">Back to top ↑</a></div>
    </div></PublicShell>
  );
}
