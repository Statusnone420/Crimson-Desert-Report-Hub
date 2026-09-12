"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import type { ConfirmationKind } from "@/lib/confirmations";
import type { IssueReadoutAsk, ReadoutTone } from "@/lib/readout";
import type { PublicIssueClaim } from "@/lib/publicClaimContext.server";

type BoardView = "published" | "watchlist";

export type IssueBoardEntry = { id: string; title: string; category: string; categoryLabel: string; description: string | null; status: string; tone: ReadoutTone; sentence: string; directReportCount: number; signalCount: number; candidateSignalCount: number; confirmationCount: number; reportPlatforms: string[]; platformCounts: { label: string; reports: number; confirmations: number }[]; excerpts: { text: string; platform: string }[]; sourceLeadCount: number; sourceLeads: { id: string; source: string; url: string; summary: string }[]; ask: IssueReadoutAsk | null; poll: { fixedCount: number; stillCount: number; escalated: boolean } | null; confirmationCounts: Partial<Record<ConfirmationKind, number>>; storageScope: string; officialClaims?: PublicIssueClaim[]; officialClaimsUnavailable?: boolean };

const CATEGORY_ART: Record<string, { icon: string; image: string; position: string; alt: string }> = {
  performance: { icon: "gauge", image: "/official/graphics.jpg", position: "center", alt: "A sunlit valley in Crimson Desert" },
  crash_startup: { icon: "triangle-alert", image: "/official/interface.png", position: "48% center", alt: "A Crimson Desert environment" },
  controls_gameplay: { icon: "gamepad-2", image: "/official/content.jpg", position: "35% center", alt: "An adventurer in Crimson Desert" },
  graphics_visual: { icon: "aperture", image: "/official/graphics.jpg", position: "center", alt: "A sunlit valley in Crimson Desert" },
  audio: { icon: "music", image: "/official/other.jpg", position: "48% center", alt: "A Crimson Desert environment" },
  quest_progression: { icon: "scroll-text", image: "/official/content.jpg", position: "40% center", alt: "An adventurer in Crimson Desert" },
  other: { icon: "wrench", image: "/official/other.jpg", position: "48% center", alt: "A Crimson Desert environment" },
};
function OfficialIssueClaims({ issue }: { issue: IssueBoardEntry }) {
  const claims = issue.officialClaims ?? [];
  return (
    <section className="dispatch-official-claims" aria-labelledby={`official-claims-${issue.id}`}>
      <h3 id={`official-claims-${issue.id}`}>Official {claims.length > 1 ? "fixes" : "fix"} being checked</h3>
      {claims.length > 0 ? (
        <>
          <ul>
            {claims.map((claim) => (
              <li key={claim.key}>
                {claim.section ? <p className="dispatch-claim-section">{claim.section}</p> : null}
                <blockquote>{claim.text}</blockquote>
                <div className="dispatch-claim-links">
                  <Link href={`/patches#claim-${claim.key}`}>Find this fix in the patch record →</Link>
                  <a href={claim.officialUrl} target="_blank" rel="noreferrer noopener">Pearl Abyss source ↗</a>
                </div>
              </li>
            ))}
          </ul>
          <p className="dispatch-claim-note">Check the conditions in the official claim before adding your result.</p>
        </>
      ) : (
        <>
          <p>{issue.officialClaimsUnavailable ? "The exact official claim could not be read." : "No confirmed official claim is attached to this issue."}</p>
          <Link href="/patches#claims">Review the official fix record →</Link>
        </>
      )}
    </section>
  );
}

function artFor(category: string) { return CATEGORY_ART[category] ?? CATEGORY_ART.other; }
function CategorySymbol({ category }: { category: string }) { const art = artFor(category); return <span className="category-symbol" aria-hidden="true" style={{ maskImage: `url(/icons/${art.icon}.svg)` }} />; }
function plural(count: number, single: string, multiple = `${single}s`) { return `${count} ${count === 1 ? single : multiple}`; }

export function filterBoardEntries(entries: IssueBoardEntry[], query: string, category: string): IssueBoardEntry[] {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (category === "all" || entry.category === category) && `${entry.title} ${entry.categoryLabel}`.toLocaleLowerCase().includes(search));
}

export function IssueBoard({ published, watchlist, monitoredCount, emptyPatchVersion }: { published: IssueBoardEntry[]; watchlist: IssueBoardEntry[]; monitoredCount: number; emptyPatchVersion: string }) {
  const [view, setView] = useState<BoardView>("published");
  const viewId = useId();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const entries = view === "published" ? published : watchlist;
  const visible = useMemo(() => filterBoardEntries(entries, query, category), [entries, query, category]);
  const categories = useMemo(() => [...new Map([...published, ...watchlist].map((entry) => [entry.category, entry.categoryLabel])).entries()], [published, watchlist]);
  const watchlistCount = watchlist.length + monitoredCount;
  const filtered = Boolean(query.trim()) || category !== "all";
  function resetFilters() { setQuery(""); setCategory("all"); }
  function openWatchlist(nextCategory = "all") { setView("watchlist"); setCategory(nextCategory); setQuery(""); }
  return <section id="board" aria-label="Issue board">
    <div className="board-view-switch" role="group" aria-label="Choose board view"><button aria-pressed={view === "published"} aria-controls="board-results" onClick={() => setView("published")}><span>Published issues</span><span className="board-view-count">{published.length}</span>{view === "published" ? <motion.span className="board-view-line" layoutId={`${viewId}-selected`} transition={{ duration: reducedMotion ? 0 : .2, ease: [.22, 1, .36, 1] }} aria-hidden="true" /> : null}</button><button aria-pressed={view === "watchlist"} aria-controls="board-results" onClick={() => setView("watchlist")}><span>Watchlist</span><span className="board-view-count">{watchlist.length}</span>{view === "watchlist" ? <motion.span className="board-view-line" layoutId={`${viewId}-selected`} transition={{ duration: reducedMotion ? 0 : .2, ease: [.22, 1, .36, 1] }} aria-hidden="true" /> : null}</button></div>
    <div className="board-filters"><label className="board-search"><span>Find an issue</span><input type="search" placeholder="Search titles, categories…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="board-clear" disabled={!filtered} onClick={resetFilters}>Clear filters</button></div>
    <div className="board-results-note"><p role="status">Showing {visible.length} of {entries.length} {view === "published" ? (entries.length === 1 ? "published issue" : "published issues") : "public watchlist leads"}</p><span>Current public board</span></div>
    <div id="board-results">{view === "published" ? <div className="player-desk-layout"><div className="player-dispatches">{visible.map((issue) => <PublishedIssue key={issue.id} issue={issue} />)}</div>{watchlistCount > 0 ? <WatchIndex watchlist={watchlist} monitoredCount={monitoredCount} categories={categories} openWatchlist={openWatchlist} /> : null}</div> : <Watchlist visible={visible} categories={categories} />}{visible.length === 0 ? <EmptyBoard view={view} resetFilters={resetFilters} emptyPatchVersion={emptyPatchVersion} hasFilters={filtered} /> : null}</div>
    {view === "watchlist" && monitoredCount > 0 ? <p className="board-monitored">The board also monitors {plural(monitoredCount, "additional watchlist issue")}. These entries have no public title, so filters cannot match them.</p> : null}
    <details className="board-method"><summary>How this board counts reports</summary><p>Reports contain player-submitted details. Check-ins are lightweight player signals. Watchlist leads come from scanning or the maintainer. These counts stay separate, and quiet does not mean fixed. <Link href="/about#method">Read the method →</Link></p></details>
  </section>;
}

function PublishedIssue({ issue }: { issue: IssueBoardEntry }) { const art = artFor(issue.category); const pollTotal = (issue.poll?.fixedCount ?? 0) + (issue.poll?.stillCount ?? 0); const fixedPercent = pollTotal > 0 ? Math.round(((issue.poll?.fixedCount ?? 0) / pollTotal) * 100) : 0; return <article className={`report-dispatch issue-category-${issue.category}`} aria-labelledby={`title-${issue.id}`}><div className="dispatch-topline"><span className="dispatch-category"><CategorySymbol category={issue.category} />{issue.categoryLabel}</span><span className={`dispatch-status dispatch-status--${issue.tone}`}>{issue.status}</span></div><div className="dispatch-heading"><div><h2 id={`title-${issue.id}`}>{issue.title}</h2><p className="dispatch-byline">{plural(issue.directReportCount, "player report")} · {plural(issue.confirmationCount, "check-in")}</p></div><figure><Image src={art.image} alt={art.alt} width={1920} height={1080} sizes="(max-width: 750px) 100vw, 160px" style={{ objectPosition: art.position }} /><figcaption>Image: Pearl Abyss</figcaption></figure></div>{issue.description ? <p className="dispatch-description">{issue.description}</p> : null}<dl className="dispatch-facts">{issue.platformCounts.length === 0 ? <div><dt>Platform</dt><dd>{issue.reportPlatforms.length > 0 ? issue.reportPlatforms.join(", ") : "Not in public reports"}</dd></div> : null}<div><dt>Source leads</dt><dd>{plural(issue.sourceLeadCount, "public lead")}</dd></div><div><dt>Player record</dt><dd>{issue.sentence}</dd></div></dl>{issue.platformCounts.length > 0 ? <table className="dispatch-platform-record"><caption>Player reports and check-ins by platform</caption><thead><tr><th scope="col">Platform</th><th scope="col">Reports</th><th scope="col">Check-ins</th></tr></thead><tbody>{issue.platformCounts.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.reports}</td><td>{row.confirmations}</td></tr>)}</tbody></table> : null}{issue.poll ? <OfficialIssueClaims issue={issue} /> : null}{issue.poll ? <div className="verdict-rail"><p>Player results after the claim</p>{pollTotal > 0 ? <><div className="verdict-bar" role="presentation"><div className="verdict-bar__fixed" style={{ width: `${fixedPercent}%` }} /><div className="verdict-bar__still" style={{ width: `${100 - fixedPercent}%` }} /></div><div className="verdict-labels"><span className="verdict-labels__fixed"><strong>{issue.poll.fixedCount}</strong><span>fixed for me</span></span><span className="verdict-labels__still"><strong>{issue.poll.stillCount}</strong><span>still happening</span></span></div></> : <p className="verdict-quiet">No player verdicts yet</p>}</div> : null}{issue.excerpts.length > 0 ? <details className="dispatch-excerpt"><summary>Read the public report</summary>{issue.excerpts.map((excerpt, index) => <blockquote key={`${issue.id}-${index}`}>“{excerpt.text}” <cite>— {excerpt.platform} player</cite></blockquote>)}<p>One report describes one player’s experience.</p></details> : null}{issue.sourceLeads.length > 0 ? <details className="dispatch-excerpt"><summary>Read public source leads</summary>{issue.sourceLeads.map((lead) => <p key={lead.id}><a href={lead.url} target="_blank" rel="noreferrer noopener">{lead.source}</a> · {lead.summary}</p>)}<p>Links are leads, never player evidence.</p></details> : null}<IssueActions issue={issue} /></article>; }
function IssueActions({ issue }: { issue: IssueBoardEntry }) { return <div className="dispatch-actions">{issue.ask ? <ConfirmButtons clusterId={issue.id} storageScope={issue.storageScope} question={issue.ask.question} kinds={issue.ask.kinds} counts={issue.confirmationCounts} /> : null}<Link href={`/report?issue=${encodeURIComponent(issue.id)}`}>File a player report →</Link></div>; }
function WatchIndex({ watchlist, monitoredCount, categories, openWatchlist }: { watchlist: IssueBoardEntry[]; monitoredCount: number; categories: [string, string][]; openWatchlist: (category?: string) => void }) { const total = watchlist.length + monitoredCount; return <aside className="watch-index" aria-labelledby="watch-index-title"><div className="watch-index-heading"><div><p className="kicker">Still on the radar</p><h2 id="watch-index-title">The watchlist</h2></div><span>{watchlist.length}<small>public leads</small></span></div><p className="watch-index-intro">Leads across patches, waiting for player evidence.</p><div className="watch-index-categories">{categories.map(([key, label]) => { const count = watchlist.filter((issue) => issue.category === key).length; return <button className={`watch-index-category issue-category-${key}`} key={key} onClick={() => openWatchlist(key)} disabled={count === 0}><CategorySymbol category={key} /><span>{label}</span><strong>{count}</strong><span aria-hidden="true">↗</span></button>; })}</div><p className="watch-index-note">Showing {watchlist.length} of {total} watchlist issue{total === 1 ? "" : "s"}{monitoredCount > 0 ? ` · Monitoring ${monitoredCount} additional watchlist issue${monitoredCount === 1 ? "" : "s"}.` : "."}</p><button className="watch-index-all" onClick={() => openWatchlist()}>Explore the full watchlist →</button><div className="watch-index-tip"><p className="eyebrow">Reporting something new?</p><p>Your platform, patch version and steps to reproduce it help make the report useful.</p></div></aside>; }
function Watchlist({ visible, categories }: { visible: IssueBoardEntry[]; categories: [string, string][] }) { return <><p className="watchlist-intro">Public leads, grouped by category. Scanner sightings are not player reports.</p><div className="board-watchlist">{categories.map(([category, label]) => { const matches = visible.filter((issue) => issue.category === category); if (matches.length === 0) return null; const art = artFor(category); return <section className={`watch-category issue-category-${category}`} key={category} aria-labelledby={`watch-category-${category}`}><div className="watch-category-heading"><CategorySymbol category={category} /><h2 id={`watch-category-${category}`}>{label}</h2><span>{plural(matches.length, "lead")}</span></div><figure><Image src={art.image} alt="" width={1920} height={1080} sizes="(max-width: 750px) 100vw, 33vw" style={{ objectPosition: art.position }} /><figcaption>Image: Pearl Abyss</figcaption></figure>{matches.map((issue) => <article className="watch-entry" key={issue.id}><h3>{issue.title}</h3><p className="watch-entry-signal">{issue.candidateSignalCount > 0 ? `The scanner spotted this ${plural(issue.candidateSignalCount, "time")} — a lead, not evidence.` : issue.sentence}</p><details><summary>Why it’s watched</summary><p>{issue.sentence}</p><IssueActions issue={issue} /></details></article>)}</section>; })}</div></>; }
function EmptyBoard({ view, resetFilters, emptyPatchVersion, hasFilters }: { view: BoardView; resetFilters: () => void; emptyPatchVersion: string; hasFilters: boolean }) {
  const isEmpty = !hasFilters;
  const title = isEmpty
    ? view === "published" ? `No published issues yet for ${emptyPatchVersion}.` : "No public leads in the watchlist yet."
    : `No matching ${view === "published" ? "published issues" : "public leads"}.`;
  const description = isEmpty
    ? view === "published"
      ? "Publishing needs a player report or corroborated sources. Leads stay private until they are corroborated."
      : "New public leads will appear here when they are available. You can still report a problem you have experienced."
    : "Try another search or category. An empty result does not mean the game is free of issues.";
  return <div className="board-empty"><span className="category-symbol" aria-hidden="true" style={{ maskImage: "url(/icons/scroll-text.svg)" }} /><h2>{title}</h2><p>{description}</p>{isEmpty ? <Link href="/report">File a player report →</Link> : <button onClick={resetFilters}>Show all {view === "published" ? "published issues" : "public leads"} →</button>}</div>;
}
