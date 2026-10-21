import Image from "next/image";
import Link from "next/link";
import { ClickToPlay } from "@/components/newspaper/ClickToPlay";
import { DirectionIcon, ReadingLink } from "@/components/newspaper/ReadingLink";
import { SectionNavigation } from "@/components/newspaper/SectionNavigation";
import type { CatchUpMilestone } from "@/lib/catchUpContent";
import { formatUtcTimestamp } from "@/lib/editorials/content";
import {
  countdownWords,
  EXPANSION,
  expansionNotices,
  expansionRelease,
  expansionVideos,
  launchState,
  NOT_SAID_YET,
  STORE_PRICE,
  VIDEO_STILLS,
  type ExpansionVideo,
} from "@/lib/expansion";
import { officialWatchSelection } from "@/lib/watchSelections";
import { parseYouTubeVideoUrl } from "@/lib/youtubeVideoUrl";

const SAID = { id: "said", label: "What Pearl Abyss has said" };
const WATCH = { id: "watch", label: "Official videos" };
const PRICE = { id: "price", label: "Price" };
const NOT_SAID = { id: "not-said", label: "Not said yet" };
const day = (iso: string, year = false) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const utcTime = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`;
const checked = (date: string) => day(`${date}T00:00:00Z`, true);

function lead(at: string | null, now: number): string {
  if (!at) return "No release date announced yet.";
  const state = launchState(at, now);
  return state?.phase === "countdown" ? `Lands ${countdownWords(state.days)}, ${formatUtcTimestamp(at)}.` : `Out since ${formatUtcTimestamp(at)}.`;
}

function Video({ video }: { video: ExpansionVideo }) {
  const category = `Official · Crimson Desert${video.publishedAt ? ` · ${day(video.publishedAt)}` : ""}`;
  const still = VIDEO_STILLS[video.videoId];
  if (!still) {
    return (
      <a className="video-link" href={video.url} target="_blank" rel="noreferrer noopener">
        <span className="video-category">{category}</span>
        <strong>{video.label}</strong>
        <span>Watch on YouTube <DirectionIcon direction="external" /></span>
      </a>
    );
  }
  return (
    <figure className={`desk-video${still.height > still.width ? " is-tall" : ""}`}>
      <ClickToPlay videoId={video.videoId} url={video.url} title={video.label} still={still} />
      <figcaption>
        <span className="video-category">{category}</span>
        <strong>{video.label}</strong>
        <a href={video.url} target="_blank" rel="noreferrer noopener">Watch on YouTube <DirectionIcon direction="external" /></a>
      </figcaption>
    </figure>
  );
}

/**
 * The expansion desk, built from the official notices on the catch-up timeline as the Hub had them
 * at `now`: a newer notice changes the date, the lines and the videos here without a page edit.
 */
export function ExpansionDesk({ now, milestones }: { now: number; milestones?: readonly CatchUpMilestone[] }) {
  const notices = expansionNotices(now, milestones);
  const release = expansionRelease(notices);
  const state = release ? launchState(release.at, now) : null;
  const videos = expansionVideos(notices);
  const reveal = parseYouTubeVideoUrl(officialWatchSelection.url);
  if (reveal.ok && !videos.some((video) => video.videoId === reveal.videoId)) {
    videos.push({ label: officialWatchSelection.headline, url: officialWatchSelection.url, videoId: reveal.videoId, publishedAt: null });
  }
  // "Not said yet" is checked against the notices, so it only shows beside them.
  const sections = notices.length ? [SAID, WATCH, PRICE, NOT_SAID] : [SAID, WATCH, PRICE];
  return (
    <article className="dispatch-container expansion-desk" id="article-top">
      <a className="skip" href="#article-body">Skip to the desk</a>
      <div className="article-heading">
        <ReadingLink variant="quiet" direction="back" className="back-link" href="/">Back to the front page</ReadingLink>
        <p className="kicker">Expansion desk</p>
        <h1>{EXPANSION.name}</h1>
        <p className="article-deck">{lead(release?.at ?? null, now)}</p>
        <p className="article-meta">
          <span>From Pearl Abyss’s official notices</span>
          <span>Times in UTC</span>
          {state?.phase === "watch" ? <Link href="/#launch-watch">Launch week on the front page</Link> : null}
        </p>
      </div>
      <figure className="article-hero">
        <div className="coast-crop"><Image src="/official/coast.jpg" width={1920} height={1180} priority sizes="(max-width:1440px) 100vw, 1384px" alt="A rider overlooking the sea, rocky islands and a sailing ship" /></div>
        <figcaption>Pywel coastline · Official base-game image, courtesy of Pearl Abyss.</figcaption>
      </figure>
      <section className="mobile-brief" aria-label="At a glance">
        <p className="eyebrow">At a glance</p>
        <dl>
          <div><dt>Release</dt><dd>{release ? formatUtcTimestamp(release.at) : "Not announced"}</dd></div>
          {state ? <div><dt>Status</dt><dd>{state.phase === "countdown" ? `Lands ${countdownWords(state.days)}` : "Out now"}</dd></div> : null}
          <div><dt>Price</dt><dd>{STORE_PRICE.text}</dd></div>
        </dl>
        <details><summary>Jump to a section</summary><div className="mobile-contents"><SectionNavigation sections={sections} label="On this desk" variant="rail" /></div></details>
      </section>
      <div className="reading-grid">
        <aside className="article-rail" aria-label="Desk contents">
          <SectionNavigation sections={sections} label="On this desk" variant="rail" />
          {release ? (
            <div className="release-note">
              <p className="kicker">{state?.phase === "countdown" ? "Release" : "Released"}</p>
              <strong>{day(release.at)}</strong>
              <span>{new Date(release.at).getUTCFullYear()} · {utcTime(release.at)}</span>
              <ReadingLink variant="source" source="Pearl Abyss" href={release.notice.source.url}>Latest notice with the date</ReadingLink>
            </div>
          ) : null}
        </aside>
        <div id="article-body" className="article-body">
          <h2 id="said" tabIndex={-1}>What Pearl Abyss has said</h2>
          {notices.length ? notices.map((notice) => (
            <section key={notice.id} className="desk-notice" aria-labelledby={`notice-${notice.id}`}>
              <p className="kicker"><time dateTime={notice.publishedAt}>{day(notice.publishedAt, true)}</time></p>
              <h3 id={`notice-${notice.id}`}>{notice.title}</h3>
              <ul>{(notice.noticeSays ?? [notice.summary]).map((line) => <li key={line}>{line}</li>)}</ul>
              <ReadingLink variant="source" source={new URL(notice.source.url).hostname} href={notice.source.url}>{notice.source.label}</ReadingLink>
            </section>
          )) : <p>No official notice about the expansion is on the Hub’s timeline yet.</p>}

          <section id="watch" tabIndex={-1} className="watch-section" aria-labelledby="watch-title">
            <p className="kicker">Watch</p>
            <h2 id="watch-title">Official videos</h2>
            <p className="desk-note">Videos load from YouTube only when you press play.</p>
            {videos.map((video) => <Video key={video.videoId} video={video} />)}
          </section>

          <h2 id="price" tabIndex={-1}>Price</h2>
          <p className="desk-price"><strong>{STORE_PRICE.text}</strong>, checked {checked(STORE_PRICE.checkedAt)}. {STORE_PRICE.note}</p>
          <ReadingLink variant="source" source={new URL(STORE_PRICE.source.url).hostname} href={STORE_PRICE.source.url}>{STORE_PRICE.source.label}</ReadingLink>

          {notices.length ? <>
            <h2 id="not-said" tabIndex={-1}>Not said yet</h2>
            <p>No notice above gives these. Checked {checked(NOT_SAID_YET.checkedAt)}.</p>
            <ul className="desk-open">
              {NOT_SAID_YET.items.map((item) => (
                <li key={item.text}>{item.text}{"source" in item ? <> <a href={item.source.url} target="_blank" rel="noreferrer noopener">{item.source.label}</a></> : null}</li>
              ))}
            </ul>
          </> : null}
          <ReadingLink variant="quiet" className="desk-more" href="/catch-up">Every notice and patch in order</ReadingLink>
        </div>
      </div>
    </article>
  );
}
