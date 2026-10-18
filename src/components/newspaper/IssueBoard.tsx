"use client";

import { DirectionIcon, ReadingLink } from "@/components/newspaper/ReadingLink";
import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import type { CheckinCounts, ConfirmationKind } from "@/lib/confirmations";
import type { IssueReadoutAsk, ReadoutTone } from "@/lib/readout";
import type { PublicIssueClaim } from "@/lib/publicClaimContext.server";
import type { BoardWatchRead, BoardWatchSummary } from "@/lib/boardWatch";
import { CATEGORY_LABELS } from "@/lib/constants";

type BoardView = "published" | "watchlist";
type SavedCheckinHandler = (clusterId: string, counts: CheckinCounts | null) => void;

function subscribeToIssueHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}
const issueHashSnapshot = () => window.location.hash;
const serverIssueHash = () => "";

export type IssueBoardEntry = { id: string; title: string; category: string; categoryLabel: string; description: string | null; status: string; tone: ReadoutTone; sentence: string; directReportCount: number; signalCount: number; candidateSignalCount: number; confirmationCount: number; earlierCheckinCount?: number; checkinsAvailable?: boolean; platformCountsPending?: boolean; reportPlatforms: string[]; platformCounts: { label: string; reports: number; confirmations: number; experiences?: string }[]; excerpts: { text: string; platform: string }[]; sourceLeadCount: number; sourceLeads: { id: string; source: string; url: string; summary: string }[]; ask: IssueReadoutAsk | null; poll: { fixedCount: number; stillCount: number; escalated: boolean } | null; confirmationCounts: Partial<Record<ConfirmationKind, number>>; storageScope: string; officialClaims?: PublicIssueClaim[]; officialClaimsUnavailable?: boolean; hasCurrentClaim?: boolean };

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
                  <ReadingLink href={`/patches#claim-${claim.key}`}>Find this fix in the patch record</ReadingLink>
                  <ReadingLink variant="quiet" href={claim.officialUrl} target="_blank" rel="noreferrer noopener">Pearl Abyss source</ReadingLink>
                </div>
              </li>
            ))}
          </ul>
          <p className="dispatch-claim-note">Check the conditions in the official claim before adding your result.</p>
        </>
      ) : (
        <>
          <p>{issue.officialClaimsUnavailable ? "The exact official claim could not be read." : "No confirmed official claim is attached to this issue."}</p>
          <ReadingLink href="/patches#claims">Review the official fix record</ReadingLink>
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

export function IssueBoard({ published: publicEntries, watchlist: watchEntries, emptyPatchVersion, watching = null }: { published: IssueBoardEntry[]; watchlist: IssueBoardEntry[]; emptyPatchVersion: string; watching?: BoardWatchRead }) {
  const issueHash = useSyncExternalStore(subscribeToIssueHash, issueHashSnapshot, serverIssueHash);
  const [selection, setSelection] = useState<{ hash: string; view: BoardView } | null>(null);
  const [saved, setSaved] = useState<{ hash: string; issue: IssueBoardEntry; source: IssueBoardEntry } | null>(null);
  // Retain only a card this reader already saw. Hidden topics never cross the
  // public server-component boundary; fresh totals come from the saving POST.
  const receipt = saved?.hash === issueHash && saved.issue.storageScope === emptyPatchVersion ? saved.issue : null;
  const receiptContext = useRef<{
    publicEntries: IssueBoardEntry[]; watchEntries: IssueBoardEntry[]; receipt: IssueBoardEntry | null;
    issueHash: string; emptyPatchVersion: string; selection: typeof selection;
  } | null>(null);
  useLayoutEffect(() => {
    receiptContext.current = { publicEntries, watchEntries, receipt, issueHash, emptyPatchVersion, selection };
    return () => { receiptContext.current = null; };
  }, [publicEntries, watchEntries, receipt, issueHash, emptyPatchVersion, selection]);
  // Override the pre-save card while refresh is pending. A new server entry
  // replaces the receipt as soon as the refresh supplies authoritative data.
  const published = useMemo(() => publicEntries.map((issue) => receipt && issue === saved?.source ? receipt : issue), [publicEntries, receipt, saved]);
  const watchlist = useMemo(() => watchEntries.map((issue) => receipt && issue === saved?.source ? receipt : issue), [watchEntries, receipt, saved]);
  const linkedIssue = [...published, ...watchlist].find((issue) => issueHash === `#issue-${issue.id}`);
  const savedPublicIssue = [...published, ...watchlist].find((issue) => issue.id === receipt?.id);
  const retainedIssue = savedPublicIssue ? null : receipt;
  const savedIssue = savedPublicIssue ?? retainedIssue;
  const focusedIssue = savedIssue ?? linkedIssue;
  const view = savedPublicIssue ? (watchlist.some((issue) => issue.id === savedPublicIssue.id) ? "watchlist" : "published")
    : selection?.hash === issueHash ? selection.view
    : watchlist.some((issue) => issue.id === linkedIssue?.id) ? "watchlist" : "published";
  function setView(nextView: BoardView) { setSaved(null); setSelection({ hash: issueHash, view: nextView }); }
  function followSavedIssue(issueId: string, counts: CheckinCounts | null) {
    const context = receiptContext.current;
    // An automatic publication change may unmount the submitting card. Its
    // callback can still update this board, unless the reader left its context.
    if (!context || context.issueHash !== issueHash || context.emptyPatchVersion !== emptyPatchVersion || context.selection !== selection) return;
    const issue = [...context.publicEntries, ...context.watchEntries].find((entry) => entry.id === issueId) ?? (context.receipt?.id === issueId ? context.receipt : null);
    if (!issue) return;
    setSaved({ hash: issueHash, source: issue, issue: {
      ...issue,
      checkinsAvailable: counts !== null,
      confirmationCounts: counts ?? {},
      confirmationCount: counts?.totalCount ?? issue.confirmationCount,
      poll: counts && issue.poll ? { ...issue.poll, fixedCount: counts.fixed_for_me, stillCount: counts.still_happening } : issue.poll,
      platformCountsPending: counts !== null,
    } });
  }
  useEffect(() => {
    if (!focusedIssue) return;
    const card = document.getElementById(`issue-${focusedIssue.id}`);
    const savedButton = savedIssue ? card?.querySelector<HTMLElement>('.confirmation-checkin__row button[aria-pressed="true"], .checkin-unavailable') : null;
    if (savedButton) {
      savedButton.focus({ preventScroll: true });
      savedButton.scrollIntoView({ block: "nearest" });
    } else {
      card?.scrollIntoView({ block: "start" });
    }
  }, [focusedIssue, savedIssue, view]);
  const viewId = useId();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const entries = view === "published" ? published : watchlist;
  const publishedMatches = useMemo(() => filterBoardEntries(published, query, category), [published, query, category]);
  const watchlistMatches = useMemo(() => filterBoardEntries(watchlist, query, category), [watchlist, query, category]);
  const visible = view === "published" ? publishedMatches : watchlistMatches;
  const otherMatches = view === "published" ? watchlistMatches : publishedMatches;
  const otherView = view === "published" ? "watchlist" : "published";
  const categories = useMemo(() => [...new Map([...published, ...watchlist].map((entry) => [entry.category, entry.categoryLabel])).entries()], [published, watchlist]);
  const filtered = Boolean(query.trim()) || category !== "all";
  function resetFilters() { setQuery(""); setCategory("all"); }
  function openWatchlist(nextCategory = "all") {
    setView("watchlist"); setCategory(nextCategory); setQuery("");
    document.getElementById(`${viewId}-watchlist`)?.focus();
  }
  function showOtherMatches() {
    setView(otherView);
    document.getElementById(`${viewId}-${otherView}`)?.focus();
  }
  const emptyBoard = visible.length === 0 ? <EmptyBoard view={view} resetFilters={resetFilters} emptyPatchVersion={emptyPatchVersion} hasFilters={filtered} watchlistCount={watchlist.length} openWatchlist={openWatchlist} watching={watching} /> : null;
  return <section id="board" aria-label="Issue board">
    <div className="board-view-switch" role="group" aria-label="Choose board view"><button id={`${viewId}-published`} aria-pressed={view === "published"} aria-controls="board-results" onClick={() => setView("published")}><span>Published issues</span><span className="board-view-count">{publishedMatches.length}</span>{view === "published" ? <motion.span className="board-view-line" layoutId={`${viewId}-selected`} transition={{ duration: reducedMotion ? 0 : .2, ease: [.22, 1, .36, 1] }} aria-hidden="true" /> : null}</button><button id={`${viewId}-watchlist`} aria-pressed={view === "watchlist"} aria-controls="board-results" onClick={() => setView("watchlist")}><span>Watchlist</span><span className="board-view-count">{watchlistMatches.length}</span>{view === "watchlist" ? <motion.span className="board-view-line" layoutId={`${viewId}-selected`} transition={{ duration: reducedMotion ? 0 : .2, ease: [.22, 1, .36, 1] }} aria-hidden="true" /> : null}</button></div>
    <div className="board-filters"><label className="board-search"><span>Find an issue</span><input type="search" placeholder="Search titles, categories…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="board-clear" disabled={!filtered} onClick={resetFilters}>Clear filters</button></div>
    <div className="board-results-note"><p role="status">Showing {visible.length} of {entries.length} {view === "published" ? (entries.length === 1 ? "published issue" : "published issues") : (entries.length === 1 ? "public watchlist topic" : "public watchlist topics")}{filtered ? ` · ${plural(publishedMatches.length + watchlistMatches.length, "match", "matches")} across both views` : ""}</p><span>Current public board</span></div>
    {filtered && otherMatches.length > 0 ? <div className="board-cross-view"><button className="reading-link reading-link--quiet" aria-controls="board-results" onClick={showOtherMatches}><span className="reading-link__label">View {plural(otherMatches.length, otherView === "published" ? "matching published issue" : "matching watchlist topic")}</span><DirectionIcon /></button></div> : null}
    <div id="board-results">{view === "published" ? <div className="player-desk-layout"><div className="player-dispatches">{visible.map((issue) => <PublishedIssue key={issue.id} issue={issue} onSaved={followSavedIssue} wasSaved={issue.id === savedIssue?.id} />)}{emptyBoard}</div>{watchlist.length > 0 ? <WatchIndex watchlist={watchlist} categories={categories} openWatchlist={openWatchlist} /> : null}</div> : <><Watchlist visible={visible} categories={categories} onSaved={followSavedIssue} savedIssueId={savedIssue?.id} />{emptyBoard}</>}</div>
    {retainedIssue ? <article id={`issue-${retainedIssue.id}`} className="watch-entry" aria-labelledby={`receipt-${retainedIssue.id}`}><h3 id={`receipt-${retainedIssue.id}`}>{retainedIssue.title}</h3><p className="watch-entry-signal">Your check-in receipt. This topic is no longer on the public board.</p><IssueActions issue={retainedIssue} onSaved={followSavedIssue} wasSaved /></article> : null}
    <details className="board-method"><summary>What these check-ins mean</summary><p>Check-ins describe personal experiences on the named patch. They are not verified unique players or proof that an issue affects everyone. One network has one answer per issue per patch; changing an answer replaces it. Shared networks share that answer. Earlier reports and scanner leads stay separate. Quiet does not mean fixed. <a href="/about#registers">Read the method</a></p></details>
  </section>;
}

function PublishedIssue({ issue, onSaved, wasSaved }: { issue: IssueBoardEntry; onSaved: SavedCheckinHandler; wasSaved: boolean }) { const art = artFor(issue.category); const pollTotal = (issue.poll?.fixedCount ?? 0) + (issue.poll?.stillCount ?? 0); const fixedPercent = pollTotal > 0 ? Math.round(((issue.poll?.fixedCount ?? 0) / pollTotal) * 100) : 0; return <article id={`issue-${issue.id}`} className={`report-dispatch issue-category-${issue.category}`} aria-labelledby={`title-${issue.id}`}><div className="dispatch-topline"><span className="dispatch-category"><CategorySymbol category={issue.category} />{issue.categoryLabel}</span><span className={`dispatch-status dispatch-status--${issue.tone}`}>{issue.status}</span></div><div className="dispatch-heading"><div><h2 id={`title-${issue.id}`}>{issue.title}</h2><p className="dispatch-byline">{issue.checkinsAvailable === false ? "Current check-ins unavailable" : `${plural(issue.confirmationCount, "check-in")} · Patch ${issue.storageScope}`}{issue.directReportCount > 0 ? ` · ${plural(issue.directReportCount, "earlier report")}` : ""}</p></div><figure><Image src={art.image} alt={art.alt} width={1920} height={1080} sizes="(max-width: 750px) 100vw, 160px" style={{ objectPosition: art.position }} /><figcaption>Image: Pearl Abyss</figcaption></figure></div>{issue.description ? <p className="dispatch-description">{issue.description}</p> : null}<dl className="dispatch-facts">{!issue.platformCountsPending && issue.platformCounts.length === 0 ? <div><dt>Platform</dt><dd>{issue.reportPlatforms.length > 0 ? issue.reportPlatforms.join(", ") : "No platform responses yet"}</dd></div> : null}<div><dt>Source leads</dt><dd>{plural(issue.sourceLeadCount, "public lead")}</dd></div><div><dt>Community record</dt><dd>{issue.sentence}</dd></div></dl>{issue.platformCountsPending ? <p className="checkin-history" role="status">Platform breakdown awaits refresh.</p> : issue.platformCounts.length > 0 ? <table className="dispatch-platform-record"><caption>Current-patch check-ins and earlier reports by platform</caption><thead><tr><th scope="col">Platform</th><th scope="col">Earlier reports</th><th scope="col">Check-ins</th></tr></thead><tbody>{issue.platformCounts.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.reports}</td><td>{issue.checkinsAvailable === false ? "Unavailable" : <>{row.confirmations}{row.experiences ? <small className="platform-experiences">{row.experiences}</small> : null}</>}</td></tr>)}</tbody></table> : null}{issue.hasCurrentClaim || issue.poll ? <OfficialIssueClaims issue={issue} /> : null}{issue.poll ? <div className="verdict-rail"><p>Check-ins after the official claim</p>{issue.checkinsAvailable === false ? <p className="verdict-quiet">Current check-in totals unavailable.</p> : pollTotal > 0 ? <><div className="verdict-bar" role="presentation"><div className="verdict-bar__fixed" style={{ width: `${fixedPercent}%` }} /><div className="verdict-bar__still" style={{ width: `${100 - fixedPercent}%` }} /></div><div className="verdict-labels"><span className="verdict-labels__fixed"><strong>{issue.poll.fixedCount}</strong><span>fixed for me</span></span><span className="verdict-labels__still"><strong>{issue.poll.stillCount}</strong><span>still happening</span></span></div></> : <p className="verdict-quiet">No responses after this claim yet</p>}</div> : null}{issue.excerpts.length > 0 ? <details className="dispatch-excerpt"><summary>Read earlier public reports</summary>{issue.excerpts.map((excerpt, index) => <blockquote key={`${issue.id}-${index}`}>“{excerpt.text}” <cite>— {excerpt.platform} player</cite></blockquote>)}<p>One report describes one player’s experience.</p></details> : null}{issue.sourceLeads.length > 0 ? <details className="dispatch-excerpt"><summary>Read public source leads</summary>{issue.sourceLeads.map((lead) => <p key={lead.id}><a href={lead.url} target="_blank" rel="noreferrer noopener">{lead.source}</a> · {lead.summary}</p>)}<p>Links are leads, never player evidence.</p></details> : null}<IssueActions issue={issue} onSaved={onSaved} wasSaved={wasSaved} /></article>; }
function IssueActions({ issue, onSaved, wasSaved }: { issue: IssueBoardEntry; onSaved: SavedCheckinHandler; wasSaved: boolean }) {
  const exactClaimMissing = Boolean((issue.hasCurrentClaim || issue.poll) && (issue.officialClaimsUnavailable || !issue.officialClaims?.length));
  return <div className="dispatch-actions">
    {issue.checkinsAvailable === false ? <p className="checkin-unavailable" role="status" tabIndex={wasSaved ? -1 : undefined}>{wasSaved ? `Saved for patch ${issue.storageScope}. Updated totals could not be loaded.` : "Current-patch check-ins could not be loaded. Try again later."}</p>
      : exactClaimMissing ? <p className="checkin-unavailable">The exact fix context is unavailable. Check-ins for this claim will open when its source can be shown.</p>
      : issue.ask ? <ConfirmButtons clusterId={issue.id} storageScope={issue.storageScope} question={issue.ask.question} kinds={issue.ask.kinds} counts={issue.confirmationCounts} onSaved={onSaved} wasSaved={wasSaved} /> : null}
    {(issue.earlierCheckinCount ?? 0) > 0 ? <p className="checkin-history">{plural(issue.earlierCheckinCount ?? 0, "earlier check-in")} retained from the previous counting system. Excluded from this patch’s tally.</p> : null}
  </div>;
}
function WatchIndex({ watchlist, categories, openWatchlist }: { watchlist: IssueBoardEntry[]; categories: [string, string][]; openWatchlist: (category?: string) => void }) { return <aside className="watch-index" aria-labelledby="watch-index-title"><div className="watch-index-heading"><div><p className="kicker">Still on the radar</p><h2 id="watch-index-title">The watchlist</h2></div><span>{watchlist.length}<small>public {watchlist.length === 1 ? "topic" : "topics"}</small></span></div><p className="watch-index-intro">Public topics across patches. Add your experience on the current patch.</p><div className="watch-index-categories">{categories.map(([key, label]) => { const count = watchlist.filter((issue) => issue.category === key).length; return <button className={`watch-index-category issue-category-${key}`} key={key} onClick={() => openWatchlist(key)} disabled={count === 0}><CategorySymbol category={key} /><span>{label}</span><strong>{count}</strong><span aria-hidden="true">↗</span></button>; })}</div><p className="watch-index-note">{plural(watchlist.length, "public watchlist topic")} available to browse.</p><button className="watch-index-all" onClick={() => openWatchlist()}>Explore the full watchlist →</button><div className="watch-index-tip"><p className="eyebrow">A quick check-in is enough.</p><p>Choose what you are seeing and where you play. New topics come from public-source discovery and maintainer curation.</p></div></aside>; }
function Watchlist({ visible, categories, onSaved, savedIssueId }: { visible: IssueBoardEntry[]; categories: [string, string][]; onSaved: SavedCheckinHandler; savedIssueId?: string }) { return <><p className="watchlist-intro">Public watchlist topics, grouped by category. Scanner sightings are not player reports.</p><div className="board-watchlist">{categories.map(([category, label]) => { const matches = visible.filter((issue) => issue.category === category); if (matches.length === 0) return null; const art = artFor(category); return <section className={`watch-category issue-category-${category}`} key={category} aria-labelledby={`watch-category-${category}`}><div className="watch-category-heading"><CategorySymbol category={category} /><h2 id={`watch-category-${category}`}>{label}</h2><span>{plural(matches.length, "topic")}</span></div><figure><Image src={art.image} alt="" width={1920} height={1080} sizes="(max-width: 750px) 100vw, 33vw" style={{ objectPosition: art.position }} /><figcaption>Image: Pearl Abyss</figcaption></figure>{matches.map((issue) => <article id={`issue-${issue.id}`} className="watch-entry" key={issue.id}><h3>{issue.title}</h3><p className="watch-entry-signal">{issue.candidateSignalCount > 0 ? `The scanner spotted this ${plural(issue.candidateSignalCount, "time")} — a lead, not evidence.` : issue.sentence}</p><details><summary>Why it’s watched</summary><p>{issue.sentence}</p></details><IssueActions issue={issue} onSaved={onSaved} wasSaved={issue.id === savedIssueId} /></article>)}</section>; })}</div></>; }
function WatchSummary({ watching }: { watching: BoardWatchSummary }) {
  const systems = watching.systems.slice(0, 3).map((system) => `${CATEGORY_LABELS[system.category].toLowerCase()} ${system.threads}`).join(", ");
  return <p className="board-watch">The scanner is watching {plural(watching.topics, "topic")} from {plural(watching.threads, "Steam forum thread")} first seen on {watching.patchVersion}.{systems ? ` The most threads: ${systems}.` : ""} These are leads, not confirmed reports.</p>;
}

function EmptyBoard({ view, resetFilters, emptyPatchVersion, hasFilters, watchlistCount, openWatchlist, watching }: { view: BoardView; resetFilters: () => void; emptyPatchVersion: string; hasFilters: boolean; watchlistCount: number; openWatchlist: () => void; watching: BoardWatchRead }) {
  const isEmpty = !hasFilters;
  const title = isEmpty
    ? view === "published" ? `No published issues yet for ${emptyPatchVersion}.` : "No public watchlist topics yet."
    : `No matching ${view === "published" ? "published issues" : "watchlist topics"}.`;
  const description = isEmpty
    ? view === "published"
      ? "New topics come from corroborated public sources or maintainer curation. Check-ins can add an experience to an existing public topic."
      : "New public topics will appear here when they are available. There is no written-report inbox."
    : "Try another search or category. An empty result does not mean the game is free of issues.";
  return <div className="board-empty">
    <span className="category-symbol" aria-hidden="true" style={{ maskImage: "url(/icons/scroll-text.svg)" }} />
    <h2>{title}</h2>
    <p>{description}</p>
    {isEmpty && view === "published" && watching === "unavailable"
      ? <p className="board-watch np-error">The scanner&apos;s thread counts for this patch could not be read.</p>
      : isEmpty && view === "published" && watching && watching !== "unavailable" && watching.threads > 0 ? <WatchSummary watching={watching} /> : null}
    <div className="board-empty-actions">
      {isEmpty && view === "published" && watchlistCount > 0 ? <button className="reading-link reading-link--action" onClick={() => openWatchlist()}><span className="reading-link__label">Browse {plural(watchlistCount, "watchlist topic")}</span><DirectionIcon /></button> : null}
      {isEmpty ? <ReadingLink href="/patches">Read the patch record</ReadingLink> : <button onClick={resetFilters}>Show all {view === "published" ? "published issues" : "watchlist topics"} →</button>}
    </div>
  </div>;
}
