"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { CATCH_UP_COVERAGE_START, CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { catchUpDate, catchUpSelectionLabel, parseCatchUpHash, selectCatchUpMilestones } from "@/lib/catchUp";
import { CatchUpMenu } from "./CatchUpMenu";
import { useCatchUp } from "./CatchUpContext";

const subscribeHash = (listener: () => void) => { window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); };
const getHash = () => window.location.hash;
const getServerHash = () => "";

export function CatchUpExperience() {
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const selection = parseCatchUpHash(hash);
  const milestones = selectCatchUpMilestones(selection);
  const briefs = milestones.filter((item) => item.kind !== "hotfix").slice(-3);
  const briefItems = briefs.length ? briefs : milestones.slice(-3);
  const journey = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: journey, offset: ["start center", "end center"] });
  const [active, setActive] = useState("");
  const [notice, setNotice] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const { ready, available, preferences, markCaughtUp } = useCatchUp();
  const end = CATCH_UP_MILESTONES.at(-1)!.publishedAt;
  function jumpToChapter(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    }, { rootMargin: "-15% 0px -55% 0px" });
    journey.current?.querySelectorAll("article").forEach((article) => observer.observe(article));
    return () => observer.disconnect();
  }, [hash]);
  async function share() {
    try { await navigator.clipboard.writeText(window.location.href); setShareNotice("Link copied with your starting point."); }
    catch { setShareNotice("Copy this page’s address to share it."); }
  }
  return <div className="cu-page" onClick={jumpToChapter}>
    <section className="cu-intro" aria-labelledby="cu-title">
      <div className="cu-intro-copy">
        <h1 id="cu-title">Catch up<br/>on <em>Pywel.</em></h1>
        <p className="cu-deck">What changed while<br/>you were away.</p>
        <p className="cu-intro-note">Start with the brief. Explore each update below.</p>
        <div className="cu-start"><CatchUpMenu label="Choose where to begin"/><a href="#cu-brief">Read the brief <span aria-hidden="true">↓</span></a></div>
      </div>
      <figure className="cu-intro-image"><Image src="/official/graphics.jpg" alt="A sunlit forest path leading toward a fortress in Pywel" width={1920} height={1080} sizes="(max-width: 750px) 100vw, 60vw" preload/><figcaption>Crimson Desert · Pearl Abyss</figcaption></figure>
    </section>
    <div className="cu-edition"><span>{catchUpSelectionLabel(selection)}</span><span>History: {catchUpDate(CATCH_UP_COVERAGE_START)} – {catchUpDate(end, true)}</span><div className="cu-share"><button type="button" onClick={share}>Copy link <span aria-hidden="true">↗</span></button><span role="status">{shareNotice}</span></div></div>
    {selection.kind === "since" && selection.value.slice(0, 10) < CATCH_UP_COVERAGE_START.slice(0, 10) && <p className="cu-coverage">History starts with patch {CATCH_UP_MILESTONES[0].patch} on {catchUpDate(CATCH_UP_COVERAGE_START)}. Earlier changes are not covered.</p>}
    <section className="cu-brief" id="cu-brief" tabIndex={-1} aria-labelledby="cu-brief-title">
      <div className="cu-section-heading"><div><h2 id="cu-brief-title">{milestones.length ? "Before you step back in" : "You’re up to date with this edition"}</h2></div><span>{milestones.length ? `${milestones.length} moments in the story` : `Latest entry: ${catchUpDate(end)}`}</span></div>
      {milestones.length ? <ol className="cu-brief-grid">{briefItems.map((item, index) => <li key={item.id}><span className="cu-brief-number">{String(index + 1).padStart(2, "0")}</span><h3><a href={`#${item.id}`}>{item.title}</a></h3><p>{item.summary}</p><a className="cu-text-link" href={`#${item.id}`}>In the journey <span aria-hidden="true">↘</span></a></li>)}</ol> : <div className="cu-empty"><p>No newer entries in this edition. Choose an earlier date or view the highlights.</p><CatchUpMenu label="Change starting point"/></div>}
    </section>
    <div className="cu-journey" ref={journey}>
      {milestones.length > 0 && <>
        <aside className="cu-rail" aria-label="Journey chapters"><p className="cu-rail-title">The journey</p><div className="cu-rail-links"><motion.div className="cu-progress" style={{ scaleY: reduced ? 1 : scrollYProgress }} aria-hidden="true"/>{milestones.map((item, index) => <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><span>{catchUpDate(item.publishedAt)}<small>{item.patch ? `Patch ${item.patch}` : "What’s ahead"}</small></span></a>)}</div><p className="cu-rail-footnote">Oldest to newest.<br/>Official sources at every stop.</p></aside>
        <div className="cu-chapters">{milestones.map((item, index) => <article key={item.id} id={item.id} tabIndex={-1} className={`cu-milestone cu-milestone--${item.kind}`}>
          <div className="cu-chapter-meta"><span className="cu-chapter-number">{String(index + 1).padStart(2, "0")}</span><time dateTime={item.publishedAt}>{catchUpDate(item.publishedAt, true)}</time><span>{item.patch ? `Patch ${item.patch}` : "On the horizon"}</span></div>
          <h2>{item.title}</h2>
          {item.image && <figure className={`cu-chapter-image${item.image.src.endsWith("coast.jpg") ? " cu-coast" : ""}`}><Image {...item.image} alt={item.image.alt} sizes="(max-width: 750px) 100vw, 75vw"/><figcaption>Image: Pearl Abyss</figcaption></figure>}
          <div className="cu-chapter-copy"><p className="cu-chapter-summary">{item.summary}</p>{item.kind === "hotfix" ? (item.highlights.length > 0 && <details><summary>What the notes cover</summary><ul>{item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></details>) : <div className="cu-takeaways"><p className="kicker">{item.kind === "announcement" ? "What to know" : "When you return"}</p><ul>{item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></div>}</div>
          <div className="cu-sources"><a href={item.source.url} target="_blank" rel="noopener noreferrer">{item.source.label} ↗</a>{item.related?.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>)}</div>
        </article>)}</div>
      </>}
    </div>
    <section className="cu-end" aria-labelledby="cu-end-title"><h2 id="cu-end-title">End of this edition</h2><p>Updates through {catchUpDate(end)}. Visits do not mark updates as read.</p><div className="cu-end-actions"><button type="button" className="catch-up-primary" disabled={!ready || !available || !preferences.remember} onClick={() => { setNotice(markCaughtUp() ? "Your catch-up date is saved on this browser." : "This browser could not save your catch-up date."); }}>Mark me caught up <span aria-hidden="true">✓</span></button><Link href="/">Back to the front page →</Link></div>{(!available || !preferences.remember) && <p className="cu-save-note">To save your place, turn on “Remember my place” in “Catch me up”.</p>}<p className="cu-status" role="status">{notice}</p></section>
  </div>;
}
