import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { PublicShell } from "@/components/dispatch/Chrome";
import { LastVisitDeltas } from "@/components/dispatch/LastVisitDeltas";
import { PlatformPulseCards } from "@/components/dispatch/PlatformPulseCards";
import {
  ActivityDataTable,
  DivergingActivityChart,
  HeatStrip,
  RadarScreen,
  SegmentedFunnelBar,
  WeeklyStackedColumns,
} from "@/components/dispatch/RadarCharts";
import { mergeActivitySeries } from "@/lib/activitySeries";
import { categoryChartColor, chartCategories } from "@/lib/categoryColors";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { uniqueClaimAttributions } from "@/lib/claims";
import { composeDispatchBrief, formatWeeklyDelta, weeklyDeltaSentence } from "@/lib/dispatchBrief";
import { displayDescription, needsFullIssueCard } from "@/lib/evidence";
import { getTrackedPatchEditionCount } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import { radarRecencyCounts, RADAR_RECENCY_BANDS } from "@/lib/radarDisplay";
import { getPatchRadarData } from "@/lib/radar.server";
import { getDashboardData, getDailySignalRollup, getPublicScannerData } from "@/lib/queries";
import { serializeJsonLd, webSiteJsonLd } from "@/lib/structuredData";

export const revalidate = 300;

function timeAgo(iso: string | null): string {
  if (!iso) return "no reports yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

function mediumDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function officialHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "official notes";
  }
}

function nextCheckLabel(iso: string): string {
  if (new Date(iso).getTime() <= Date.now()) return "Next check eligible now";
  return `Next eligible check ${relativeTimeShort(iso)}`;
}

function relativeTimeShort(iso: string | null): string {
  if (!iso) return "n/a";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const abs = Math.abs(mins);
  const prefix = mins < 0 ? "in " : "";
  const suffix = mins < 0 ? "" : " ago";
  if (abs < 1) return mins < 0 ? "shortly" : "just now";
  if (abs < 60) return `${prefix}${abs}m${suffix}`;
  const hours = Math.floor(abs / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${Math.floor(hours / 24)}d${suffix}`;
}

export default async function DispatchHomePage() {
  const [d, scoreboard, series, edition, radarData] = await Promise.all([
    getDashboardData(),
    getPublicScannerData(),
    getDailySignalRollup(),
    getTrackedPatchEditionCount(),
    getPatchRadarData(),
  ]);
  const radar = scoreboard;

  const patch = d.currentPatch;
  const patchFamily = patchFamilyKey(patch.version) ?? patch.version;
  const totalTaps = d.topClusters.reduce((sum, cluster) => sum + cluster.confirmations.totalCount, 0);

  // Clusters whose fix claim the lifecycle pass tied to the current patch.
  const verifying = d.topClusters.filter(
    (cluster) => cluster.fix_claimed_patch_version === patch.version,
  );
  /**
   * Claims record attribution: a verbatim claim gets a verdict split only when
   * the stored categories join it to exactly one verifying cluster and that
   * category has exactly one claim (1:1). There is no claim→cluster foreign
   * key, so anything more would be a fabricated association.
   */
  const attributedByCategory = uniqueClaimAttributions(d.claimedFixes, verifying);
  const claimRows = d.claimedFixes.map((claim) => {
    const attributed = claim.category === null ? null : attributedByCategory.get(claim.category) ?? null;
    const poll = attributed?.readout.poll ?? null;
    const clockSince =
      shortDate(attributed?.fix_claimed_at ?? null) ?? shortDate(patch.publishedAt) ?? "PATCH PUBLISH";
    return { claim, attributed, poll, clockSince };
  });
  const contestedClusters = verifying.filter((cluster) => {
    if (attributedByCategory.get(cluster.category)?.id !== cluster.id) return false;
    const poll = cluster.readout.poll;
    return poll !== null && poll.stillCount > poll.fixedCount && poll.stillCount > 0;
  });
  const mostContested = contestedClusters.reduce<(typeof contestedClusters)[number] | null>(
    (best, cluster) =>
      !best || (cluster.readout.poll?.stillCount ?? 0) > (best.readout.poll?.stillCount ?? 0) ? cluster : best,
    null,
  );

  const brief = composeDispatchBrief({
    patchVersion: patch.version,
    publishedAt: patch.publishedAt,
    reports: d.total,
    taps: totalTaps,
    keptLeadsThisWeek: radar.keptThisWeek,
    contested: mostContested
      ? {
          title: mostContested.title,
          stillCount: mostContested.readout.poll?.stillCount ?? 0,
          fixedCount: mostContested.readout.poll?.fixedCount ?? 0,
        }
      : null,
    claimedFixCount: d.claimedFixes.length,
    contestedClaimCount: contestedClusters.length,
    evidenceUnavailable: d.evidenceUnavailable,
    series,
    radar: radarData.connected
      ? {
          newLeads7d: radarData.window.newLeads7d,
          reobservations7d: radarData.window.reobservations7d,
          activeLeadClusters: radarData.activeLeadClusters,
        }
      : null,
  });

  // Evidence and radar series merge onto one chart but never one lane.
  const activity = mergeActivitySeries(series, radarData.connected ? radarData.daily : null);
  const showRadarBand = radarData.connected;

  // Issue board: the same published-entry gate used by /issues, top three by evidence strength.
  const boardClusters = d.topClusters.filter(needsFullIssueCard);
  const top3 = boardClusters.slice(0, 3);
  const [leadStory, ...secondaryStories] = top3;
  const leadDataUnavailable = d.sourceLeadsUnavailable && !d.evidenceUnavailable;
  const publicLeadDataUnavailable = d.publicLeadsUnavailable && !d.evidenceUnavailable;
  const topWatch =
    boardClusters.find((cluster) => cluster.readout.state !== "public_sources_unavailable") ??
    (leadDataUnavailable ? null : d.topClusters[0] ?? null);
  const contestedSubject = mostContested?.title.replace(
    /\s+(?:persists|continues)(?:\s+after\s+(?:the\s+)?fix)?$/i,
    "",
  );
  const heroHeadline = mostContested
    ? `${contestedSubject} remains contested in ${patch.version}.`
    : publicLeadDataUnavailable
      ? `Patch ${patch.version} is live. Source-backed issue status is temporarily incomplete.`
    : topWatch
      ? `${topWatch.title} leads the ${patch.version} watchlist.`
      : `Patch ${patch.version} is live. Here’s what changed and what to watch.`;
  const heroDek = d.evidenceUnavailable
    ? `The board can't read its evidence store right now. Patch facts stay current; report and issue counts are missing, not zero.`
    : publicLeadDataUnavailable
      ? `The board can read player reports and taps, but not its public-source lead register right now. Lead-backed issue counts and rankings are missing, not zero.`
    : leadDataUnavailable
      ? `Player evidence and published source-backed issues are readable, but some radar-lead details are unavailable right now. Missing lead data is not zero.`
    : topWatch
      ? `Pearl Abyss lists ${d.claimedFixes.length} claimed ${d.claimedFixes.length === 1 ? "fix" : "fixes"}. The board is watching ${boardClusters.length} published ${boardClusters.length === 1 ? "issue" : "issues"}, while the radar tracks ${radarData.recurring.trackedLeads} sourced ${radarData.recurring.trackedLeads === 1 ? "lead" : "leads"} without treating them as player evidence.`
      : `Pearl Abyss lists ${d.claimedFixes.length} claimed ${d.claimedFixes.length === 1 ? "fix" : "fixes"}. No player-backed issue is published yet; the radar is still screening public sources for changes worth checking.`;
  const showContextBand = Boolean(
    radar.steamPulse.length > 0 || radar.platformContext || radar.pulseReadFailures.length > 0,
  );

  const verdictsElsewhere = verifying.length > 0 && claimRows.every((row) => row.attributed === null);
  const mobileClaimRow =
    claimRows.find((row) => row.attributed && mostContested && row.attributed.id === mostContested.id) ??
    claimRows[0] ??
    null;

  // Context lanes: real-dated only, coverage and asks never share a module.
  const wire = d.observations.coverage.slice(0, 3);
  const asks = d.observations.asks.slice(0, 3);
  const publishedDateLabel = mediumDate(patch.publishedAt);

  // Fixed-order chart categories for the radar screen and weekly columns.
  const radarSectors = chartCategories([
    ...radarData.categories.map((bucket) => bucket.category),
    ...radarData.weekly.flatMap((week) => Object.keys(week.counts)),
  ]);
  const radarRecency = radarRecencyCounts(radarData.recurrence);

  // Section numbering is computed from what actually renders, so empty
  // modules close ranks without leaving gaps in the numbering.
  const sectionIds: string[] = ["pulse"];
  if (showRadarBand) sectionIds.push("radar");
  if (showContextBand) sectionIds.push("context");
  sectionIds.push("board");
  if (claimRows.length > 0) sectionIds.push("claims");
  if (wire.length > 0) sectionIds.push("wire");
  if (asks.length > 0) sectionIds.push("asks");
  const sectionNo = (id: string): string => String(sectionIds.indexOf(id) + 1).padStart(2, "0");

  // Short names on purpose: the TOC is now a single-line strip closing the
  // hero band, and the descriptive detail lives in each section's own header.
  const tocLabels: Record<string, string> = {
    pulse: "Patch Pulse",
    radar: "The radar",
    context: "Platform pulse",
    board: "The issue board",
    claims: "The claims record",
    wire: "From the wire",
    asks: "Community asks",
  };
  const tocRows = sectionIds.map((id) => ({ href: `#${id}`, label: tocLabels[id], index: sectionNo(id) }));

  function statusLine(cluster: (typeof d.topClusters)[number], withCategory: boolean) {
    const tone = cluster.readout.tone;
    return (
      <div className={`status-line status-line--${tone}`}>
        <span className="status-line__dot" aria-hidden="true" />
        <span className={`status-line__label--${tone}`}>{cluster.readout.label.toUpperCase()}</span>
        {withCategory ? (
          <span className="status-line__meta">
            ·{" "}
            <i
              className="cat-swatch cat-swatch--meta"
              style={{ background: categoryChartColor(cluster.category) }}
              aria-hidden="true"
            />
            {(CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category).toUpperCase()}
          </span>
        ) : null}
      </div>
    );
  }

  function platformMeters(cluster: (typeof d.topClusters)[number]) {
    const entries = Object.entries(cluster.reportPlatformCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (entries.length === 0) return null;
    const max = Math.max(...entries.map(([, count]) => count), 1);
    return (
      <div className="platform-meters">
        {entries.map(([platform, reports]) => {
          const confirms = cluster.confirmations.byPlatform[platform]?.count ?? 0;
          return (
            <div key={platform} className="platform-meter">
              <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
              <div className="platform-meter__track">
                <div className="platform-meter__fill" style={{ width: `${Math.round((reports / max) * 100)}%` }} />
              </div>
              <span className="platform-meter__count">
                {reports} rpt · {confirms} confirm
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function tapControl(cluster: (typeof d.topClusters)[number]) {
    const ask = cluster.readout.ask;
    if (!ask) return null;
    const counts = ask.kinds.includes("have_it")
      ? { have_it: cluster.confirmations.byKind.have_it.count }
      : {
          fixed_for_me: cluster.confirmations.pollFixedCount,
          still_happening: cluster.confirmations.pollStillCount,
        };
    return (
      <ConfirmButtons
        clusterId={cluster.id}
        storageScope={ask.kinds.includes("have_it") ? patchFamily : patch.version}
        question={ask.question}
        kinds={ask.kinds}
        counts={counts}
      />
    );
  }

  function verdictSplit(poll: { fixedCount: number; stillCount: number }, note: string | null) {
    const total = poll.fixedCount + poll.stillCount;
    if (total === 0) return null;
    const fixedPct = Math.round((poll.fixedCount / total) * 100);
    return (
      <>
        <div className="verdict-bar" role="presentation">
          <div className="verdict-bar__fixed" style={{ width: `${fixedPct}%` }} />
          <div className="verdict-bar__still" style={{ width: `${100 - fixedPct}%` }} />
        </div>
        <div className="verdict-labels">
          <span className="verdict-labels__fixed">
            {poll.fixedCount} fixed for me
          </span>
          <span className="verdict-labels__still">{poll.stillCount} still happening</span>
        </div>
        {note ? <div className="verdict-note">{note}</div> : null}
      </>
    );
  }

  function verdictNote(poll: { fixedCount: number; stillCount: number }): string {
    if (poll.stillCount > poll.fixedCount)
      return "Contested. Verdicts count taps made after the claim clock, this patch only.";
    if (poll.fixedCount > poll.stillCount)
      return "Leaning fixed. Verdicts count taps made after the claim clock, this patch only.";
    return "Split. Verdicts count taps made after the claim clock, this patch only.";
  }

  return (
    <PublicShell active="brief" masthead edition={edition}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(webSiteJsonLd()) }}
      />
      <div className="dispatch-container">
        {/* Lead */}
        <section className="brief-lead" aria-label="Lead story">
          <div className="brief-lead__copy">
            <p className="dispatch-kicker">{brief.kicker}</p>
            <h2 className="brief-lead__headline">{heroHeadline}</h2>
            <p className="brief-lead__dek">{heroDek}</p>
          </div>
          <div className="brief-lead__rail">
            <div>
              <h2 className="record-block__header">The Record</h2>
              <div className="record-block__row">
                <span>Current patch</span>
                <span className="record-block__value">{patch.version}</span>
              </div>
              <div className="record-block__row">
                <span>Published</span>
                <span className="record-block__value">{publishedDateLabel ?? "not recorded"}</span>
              </div>
              <div className="record-block__row">
                <span>Claimed fixes</span>
                <span className="record-block__value">
                  {d.evidenceUnavailable && d.claimedFixes.length === 0 ? "unreadable" : d.claimedFixes.length}
                </span>
              </div>
              <div className="record-block__row">
                <span>Player verdict</span>
                <span
                  className={
                    !d.evidenceUnavailable && contestedClusters.length > 0
                      ? "record-block__value record-block__value--amber"
                      : "record-block__value"
                  }
                >
                  {d.evidenceUnavailable
                    ? "unreadable right now"
                    : d.claimedFixes.length === 0
                      ? "no claims"
                      : `${contestedClusters.length} of ${d.claimedFixes.length} contested`}
                </span>
              </div>
              <div className="record-block__row">
                <span>Official notes</span>
                <span className="record-block__value">
                  <a
                    className="dispatch-link"
                    href={patch.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {officialHost(patch.officialUrl)} ↗
                  </a>
                </span>
              </div>
            </div>
          </div>
          <div className="brief-lead__actions" aria-label="Start with the current patch">
            <a className="brief-lead__action" href={patch.officialUrl} target="_blank" rel="noreferrer noopener">
              <span>What changed</span>
              <strong>
                {d.evidenceUnavailable && d.claimedFixes.length === 0
                  ? "Official patch notes"
                  : `${d.claimedFixes.length} official fix ${d.claimedFixes.length === 1 ? "claim" : "claims"}`}
              </strong>
              <i aria-hidden="true">↗</i>
            </a>
            <Link className="brief-lead__action" href="/issues">
              <span>What appears broken</span>
              <strong>
                {topWatch?.title ??
                  (d.evidenceUnavailable
                    ? "Issue board unreadable right now"
                    : publicLeadDataUnavailable
                      ? "Source-backed issue list incomplete right now"
                      : "No published player issue yet")}
              </strong>
              <i aria-hidden="true">→</i>
            </Link>
            <Link className="brief-lead__action" href="/report">
              <span>What to check</span>
              <strong>Compare your result or file a structured report</strong>
              <i aria-hidden="true">→</i>
            </Link>
          </div>
          <ul className="brief-lead__meta dispatch-desktop-only" aria-label="Current evidence counts">
            {d.evidenceUnavailable ? (
              <>
                {d.claimedFixes.length > 0 ? <li>{d.claimedFixes.length} official claims</li> : null}
                <li>evidence counts unavailable</li>
              </>
            ) : publicLeadDataUnavailable ? (
              <>
                <li>{d.claimedFixes.length} official claims</li>
                <li>source-backed issue count unavailable</li>
              </>
            ) : (
              <>
                <li>{d.claimedFixes.length} official claims</li>
                <li>{boardClusters.length} published issues</li>
              </>
            )}
            <li>{radarData.recurring.trackedLeads} tracked radar leads</li>
            <li>
              {radarData.connected && radarData.health.lastScanAt
                ? `last scan ${relativeTimeShort(radarData.health.lastScanAt)}`
                : d.latestReportAt
                  ? `updated ${timeAgo(d.latestReportAt)}`
                  : "awaiting first source run"}
            </li>
          </ul>
          <div className="brief-fact-strip dispatch-mobile-only">
            {d.evidenceUnavailable ? (
              <>
                {d.claimedFixes.length > 0 ? <span>{d.claimedFixes.length} claims</span> : null}
                <span>counts unavailable</span>
              </>
            ) : publicLeadDataUnavailable ? (
              <>
                <span>{d.claimedFixes.length} claims</span>
                <span>issue count unavailable</span>
              </>
            ) : (
              <>
                <span>{d.claimedFixes.length} claims</span>
                <span>{boardClusters.length} issues</span>
              </>
            )}
            <span>{radarData.recurring.trackedLeads} radar leads</span>
          </div>
          <nav className="brief-lead__toc dispatch-desktop-only" aria-label="In this edition">
            <span className="brief-lead__toc-label">In This Edition</span>
            {tocRows.map((row) => (
              <a key={row.href} href={row.href} className="brief-lead__toc-row">
                <span>{row.label}</span>
                <span className="brief-lead__toc-index">{row.index}</span>
              </a>
            ))}
          </nav>
        </section>

        {/* Patch Pulse */}
        <section id="pulse" className="brief-band" aria-label="Patch Pulse">
          <div className="pulse-grid">
            <div className="pulse-main">
              <div className="brief-band__kicker-row">
                <h2 className="dispatch-kicker">{sectionNo("pulse")} · Patch Pulse</h2>
                <span className="brief-band__caption dispatch-desktop-only">
                  evidence above the line · radar intelligence below · per day since {patch.version}
                </span>
              </div>
              <p className="pulse-headline">{brief.pulseHeadline}</p>
              {activity.days.length > 0 ? <LastVisitDeltas days={activity.days} /> : null}
              {activity.days.length === 0 ? (
                <p className="brief-band__caption">
                  Daily series unavailable right now — the counts above are still live.
                </p>
              ) : (
                <>
                  {!activity.evidenceAvailable ? (
                    <p className="brief-band__caption">
                      The evidence series is unavailable right now — its lane reads empty, not zero.
                    </p>
                  ) : null}
                  <div className="dispatch-desktop-only">
                    <DivergingActivityChart
                      series={activity.days}
                      width={824}
                      laneHeight={88}
                      maxDays={14}
                      barWidth={18}
                      leftPad={24}
                      labelsInSvg
                    />
                  </div>
                  <div className="dispatch-mobile-only">
                    <DivergingActivityChart
                      series={activity.days}
                      width={350}
                      laneHeight={44}
                      maxDays={14}
                      barWidth={10}
                      leftPad={6}
                      labelsInSvg={false}
                    />
                    <div className="pulse-axis-row">
                      <span>{shortDate(activity.days[0]?.day ?? null)}</span>
                      <span>{shortDate(activity.days[activity.days.length - 1]?.day ?? null)}</span>
                    </div>
                  </div>
                </>
              )}
              <div className="pulse-legend pulse-legend--grouped dispatch-desktop-only">
                <div className="pulse-legend-group">
                  <span className="pulse-legend-group__name">Player evidence</span>
                  <span>
                    <i className="pulse-legend__reports" aria-hidden="true" />
                    structured reports
                  </span>
                  <span>
                    <i className="pulse-legend__taps" aria-hidden="true" />
                    one-tap confirmations
                  </span>
                </div>
                {activity.radarAvailable ? (
                  <div className="pulse-legend-group">
                    <span className="pulse-legend-group__name">Radar intelligence</span>
                    <span>
                      <i className="pulse-legend__leads" aria-hidden="true" />
                      new kept leads
                    </span>
                    <span>
                      <i className="pulse-legend__reobs" aria-hidden="true" />
                      re-observations
                    </span>
                  </div>
                ) : null}
              </div>
              {activity.days.length > 0 ? <ActivityDataTable series={activity.days} maxDays={14} /> : null}
              {activity.days.length > 1 ? (
                <div className="heat-strips" style={{ marginTop: 22 }}>
                  <HeatStrip
                    days={activity.days.map((day) => ({
                      day: day.day,
                      value: day.reports + day.taps,
                      detail: `${day.reports} report${day.reports === 1 ? "" : "s"} · ${day.taps} tap${day.taps === 1 ? "" : "s"}`,
                    }))}
                    tone="evidence"
                    label="Evidence"
                    ariaLabel={`Season calendar, evidence row: one cell per day since ${patch.version}, darker crimson means more player reports and taps that day.`}
                  />
                  <HeatStrip
                    days={activity.days.map((day) => ({
                      day: day.day,
                      value: day.newLeads + day.reobservations,
                      detail: `${day.newLeads} new lead${day.newLeads === 1 ? "" : "s"} · ${day.reobservations} re-obs`,
                    }))}
                    tone="radar"
                    label="Radar"
                    ariaLabel={`Season calendar, radar row: one cell per day since ${patch.version}, darker blue means more new leads and re-observations that day. Radar activity is scanner intelligence, not evidence.`}
                  />
                  <p className="radar-note">
                    The season calendar — one cell per day of {patch.version}, each register on its own ramp.
                  </p>
                </div>
              ) : null}
            </div>
            {brief.evidenceUnavailable ? (
              <div className="pulse-stats">
                <div className="pulse-stat">
                  <div className="pulse-stat__value">—</div>
                  <div className="pulse-stat__caption">
                    Evidence counts are unavailable right now — missing, not zero.
                  </div>
                </div>
              </div>
            ) : (
              <div className="pulse-stats">
                <div className="pulse-stat">
                  <div className="pulse-stat__value">{formatWeeklyDelta(brief)}</div>
                  <div className="pulse-stat__caption">{weeklyDeltaSentence(brief)}</div>
                </div>
                <div className="pulse-stat pulse-stat--secondary">
                  <div className="pulse-stat__value pulse-stat__value--crimson">
                    {mostContested?.readout.poll?.stillCount ?? 0}
                  </div>
                  <div className="pulse-stat__caption">
                    {mostContested
                      ? `Players still tapping "still happening" on ${mostContested.title}.`
                      : "No claimed fix is contested by player taps right now."}
                  </div>
                </div>
                <div className="pulse-stat pulse-stat--secondary">
                  <div className="pulse-stat__value">{radar.keptThisWeek}</div>
                  <div className="pulse-stat__caption">
                    Public leads kept by the radar this week, out of {radar.reviewedThisWeek} reviewed.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* The Radar — scanner intelligence, aggregate-only, never evidence */}
        {showRadarBand ? (
          <section id="radar" className="brief-band" aria-label="The radar">
            <div className="brief-band__header">
              <h2 className="dispatch-kicker">{sectionNo("radar")} · The Radar</h2>
              <span className="brief-band__note dispatch-desktop-only">
                Public-source intelligence, counted in aggregate. Never player evidence.
              </span>
            </div>
            <div className="stat-band stat-band--radar" style={{ marginTop: 18 }} aria-label="Radar activity">
              <div className="stat-band__cell">
                <div className="stat-band__label">New leads · 7d</div>
                <div
                  className={
                    radarData.window.newLeads7d > 0 ? "stat-band__value stat-band__value--blue" : "stat-band__value"
                  }
                >
                  {radarData.window.newLeads7d}
                </div>
                <div className="stat-band__caption">
                  Leads first seen this week and still tracked · {radarData.window.newLeads24h} in the last day
                </div>
              </div>
              <div className="stat-band__cell">
                <div className="stat-band__label">Re-observations · 7d</div>
                <div
                  className={
                    radarData.window.reobservations7d > 0
                      ? "stat-band__value stat-band__value--blue"
                      : "stat-band__value"
                  }
                >
                  {radarData.window.reobservations7d}
                </div>
                <div className="stat-band__caption">
                  Known leads seen again in later scans · {radarData.window.reobservations24h} in the last day
                </div>
              </div>
              <div className="stat-band__cell">
                <div className="stat-band__label">Active problem areas</div>
                <div className="stat-band__value">{radarData.activeLeadClusters}</div>
                <div className="stat-band__caption">Distinct issue areas holding at least one tracked lead</div>
              </div>
              <div className="stat-band__cell">
                <div className="stat-band__label">Recurring leads</div>
                <div className="stat-band__value">{radarData.recurring.recurringLeads}</div>
                <div className="stat-band__caption">
                  Of {radarData.recurring.trackedLeads} tracked leads, seen up to{" "}
                  {Math.max(1, radarData.recurring.maxSeenCount)}× so far
                </div>
              </div>
            </div>
            {radarData.recurring.trackedLeads === 0 && radarData.funnel7d.reviewed === 0 ? (
              <p className="radar-note" style={{ marginTop: 18 }}>
                The radar has nothing tracked for this patch yet. Zeros are real readings.
              </p>
            ) : (
              <div className="radar-grid radar-grid--screen">
                <div className="radar-screen-wrap">
                  <RadarScreen points={radarData.recurrence} sectors={radarSectors} size={430} />
                  <p className="radar-screen-caption">
                    Recency from center: latest scan → under 6 hours → 6–24 hours → 1–3 days → 4–7 days → 8+
                    days at the rim.
                  </p>
                  <ul className="radar-recency-legend" aria-label="Tracked leads by recency band">
                    {RADAR_RECENCY_BANDS.map((band) => (
                      <li key={band.id}>
                        <span>{band.label}</span>
                        <b>{radarRecency[band.id]}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="radar-main">
                  <div className="radar-working-set">
                    <b>{radarData.recurring.trackedLeads}</b>
                    <span>tracked leads · ranked by problem area below</span>
                  </div>
                  {radarData.categories.length > 0 ? (
                    <ol className="radar-cats" aria-label="Tracked radar leads ranked by problem area">
                      {(() => {
                        const max = Math.max(...radarData.categories.map((bucket) => bucket.tracked), 1);
                        return radarData.categories.map((bucket) => (
                          <li key={bucket.category} className="radar-cat">
                            <span>
                              {CATEGORY_LABELS[bucket.category as keyof typeof CATEGORY_LABELS] ?? bucket.category}
                            </span>
                            <div className="radar-cat__track">
                              <div
                                className="radar-cat__fill"
                                style={{
                                  width: `${Math.max(4, Math.round((bucket.tracked / max) * 100))}%`,
                                  background: categoryChartColor(bucket.category),
                                }}
                              />
                            </div>
                            <span className="radar-cat__count">
                              {bucket.tracked} lead{bucket.tracked === 1 ? "" : "s"}
                              {bucket.new7d > 0 ? <span className="is-blue"> · {bucket.new7d} new</span> : null}
                            </span>
                          </li>
                        ));
                      })()}
                    </ol>
                  ) : null}
                  {radarData.weekly.length > 1 ? (
                    <div>
                      <p className="brief-band__caption" style={{ marginBottom: 6 }}>
                        Working set by first-seen week — each color is a problem area:
                      </p>
                      <WeeklyStackedColumns weeks={radarData.weekly} categories={radarSectors} width={620} height={148} />
                    </div>
                  ) : null}
                  {radarData.funnel7d.reviewed > 0 ? (
                    <div>
                      <p className="brief-band__caption" style={{ marginBottom: 8 }}>
                        This week the radar reviewed {radarData.funnel7d.reviewed} public candidates:
                      </p>
                      <SegmentedFunnelBar
                        reviewed={radarData.funnel7d.reviewed}
                        kept={radarData.funnel7d.kept}
                        reobserved={radarData.funnel7d.reobserved}
                        filtered={radarData.funnel7d.filtered}
                      />
                    </div>
                  ) : null}
                  <p className="radar-note">
                    Counts only — lead titles and links stay private until corroboration publishes them. Times are
                    when the scanner saw a page, not when it was posted.{" "}
                    <Link href="/scanner" className="dispatch-link">
                      How the radar works →
                    </Link>
                  </p>
                  <div className="radar-health" aria-label="Scanner health">
                    <div>
                      <span
                        className={
                          radarData.health.paused
                            ? "is-amber"
                            : radarData.health.lastScanStatus === "failed"
                              ? "is-crimson"
                              : "is-green"
                        }
                      >
                        ●{" "}
                        {radarData.health.paused
                          ? "Scanner paused"
                          : radarData.health.lastScanStatus === "failed"
                            ? "Last scan failed"
                            : "Scanner active"}
                      </span>
                      {radarData.health.lastScanAt
                        ? ` · last scan ${relativeTimeShort(radarData.health.lastScanAt)}`
                        : " · no scans recorded"}
                    </div>
                    <div>
                      7d: {radarData.health.runs7d.succeeded} ok · {radarData.health.runs7d.skipped} skipped ·{" "}
                      {radarData.health.runs7d.failed > 0 ? (
                        <span className="is-amber">{radarData.health.runs7d.failed} failed</span>
                      ) : (
                        "0 failed"
                      )}
                    </div>
                    {radarData.health.nextEligibleAt ? (
                      <div>{nextCheckLabel(radarData.health.nextEligibleAt)}</div>
                    ) : null}
                    <div>
                      Source dates: {radarData.dateCoverage.withSourceDate} of {radarData.dateCoverage.tracked} leads
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {showContextBand ? (
          <section id="context" className="brief-band" aria-label="Platform pulse, context not evidence">
            <div className="brief-band__header">
              <div>
                <h2 className="dispatch-kicker dispatch-kicker--blue">{sectionNo("context")} · Platform Pulse</h2>
                <p className="pulse-headline pulse-headline--compact">Useful context that never becomes evidence.</p>
              </div>
              <span className="brief-band__note dispatch-desktop-only">
                Steam review and Twitch snapshot movement stay visibly separate from player reports.
              </span>
            </div>
            <PlatformPulseCards
              steamPulse={radar.steamPulse}
              platformContext={radar.platformContext}
              pulseReadFailures={radar.pulseReadFailures}
              brief
            />
          </section>
        ) : null}

        {/* Issue board */}
        <section id="board" className="brief-band" aria-label="The issue board">
          <div className="brief-band__header">
            <h2 className="dispatch-kicker">{sectionNo("board")} · The Issue Board</h2>
            <span style={{ fontSize: 13 }}>
              <Link href="/issues" className="dispatch-link">
                {d.evidenceUnavailable || publicLeadDataUnavailable
                  ? "Issue board →"
                  : `All ${boardClusters.length} published issue${boardClusters.length === 1 ? "" : "s"} →`}
              </Link>
            </span>
          </div>
          {leadDataUnavailable ? (
            <p className="brief-band__caption" style={{ marginTop: 8 }}>
              {publicLeadDataUnavailable
                ? "Public-source lead details are unavailable right now. Player evidence stays live; lead-backed rankings are incomplete."
                : "Some radar-lead details are unavailable right now. Player evidence and published source-backed issues stay live."}
            </p>
          ) : null}
          {top3.length === 0 ? (
            <div className="board-empty">
              {d.evidenceUnavailable ? (
                <p>The issue board can&rsquo;t be read right now — nothing here is being counted as zero.</p>
              ) : publicLeadDataUnavailable ? (
                <p>Public-source leads can&rsquo;t be read right now — no lead-backed issue is being counted as zero.</p>
              ) : (
                <p>
                  No published issues yet for {patch.version}. Publishing needs a player report or corroborated
                  sources —{" "}
                  <Link href="/about" className="dispatch-link">
                    read the method
                  </Link>
                  .
                </p>
              )}
            </div>
          ) : (
            <div className="board-grid">
              {leadStory ? (
                <article className="board-lead">
                  {statusLine(leadStory, true)}
                  <h3 className="board-lead__title">{leadStory.title}</h3>
                  <p className="board-secondary__meta dispatch-mobile-only">
                    {leadStory.directReportCount} reports · {leadStory.confirmations.totalCount} taps
                  </p>
                  {displayDescription(leadStory.title, leadStory.description) ? (
                    <p className="board-lead__summary">{displayDescription(leadStory.title, leadStory.description)}</p>
                  ) : null}
                  <div className="dispatch-desktop-only">{platformMeters(leadStory)}</div>
                  {tapControl(leadStory)}
                </article>
              ) : null}
              {secondaryStories.map((cluster) => (
                <article key={cluster.id} className="board-secondary">
                  {statusLine(cluster, false)}
                  <h3 className="board-secondary__title">{cluster.title}</h3>
                  {displayDescription(cluster.title, cluster.description) ? (
                    <p className="board-secondary__summary">{displayDescription(cluster.title, cluster.description)}</p>
                  ) : null}
                  <p className="board-secondary__meta">
                    {cluster.directReportCount} reports · {cluster.confirmations.totalCount} taps ·{" "}
                    {(CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category).toLowerCase()}
                  </p>
                  <span className="board-secondary__link">
                    <Link href="/issues" className="dispatch-link">
                      Read the story →
                    </Link>
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Claims record */}
        {claimRows.length > 0 ? (
          <section id="claims" className="brief-band" aria-label="The claims record">
            <div className="brief-band__header">
              <h2 className="dispatch-kicker">{sectionNo("claims")} · The Claims Record</h2>
              <span className="brief-band__note dispatch-desktop-only">
                What {patch.version} claims to fix, against what players say. The board never decides for them.
              </span>
            </div>
            <div className="claim-rows">
            {claimRows.map((row, index) => (
              <div
                key={`${row.claim.fixText}-${index}`}
                className={
                  mobileClaimRow && row === mobileClaimRow ? "claim-row" : "claim-row claim-row--overflow"
                }
              >
                <blockquote className="claim-row__quote">&ldquo;{row.claim.fixText}&rdquo;</blockquote>
                <div className="claim-row__verdict">
                  {row.poll && row.poll.fixedCount + row.poll.stillCount > 0 ? (
                    verdictSplit(row.poll, verdictNote(row.poll))
                  ) : d.evidenceUnavailable ? (
                    <div className="verdict-note">
                      Player verdicts can&rsquo;t be read right now — not counted as zero.
                    </div>
                  ) : row.attributed ? (
                    <div className="verdict-clock">
                      No player verdicts yet · claim clock running since {row.clockSince}
                    </div>
                  ) : verdictsElsewhere ? (
                    <div className="verdict-note">
                      Player verdicts for this patch are tracked per issue on the{" "}
                      <Link href="/issues" className="dispatch-link">
                        issue board
                      </Link>
                      ; the notes don&apos;t tie this exact line to one issue.
                    </div>
                  ) : (
                    <div className="verdict-clock">
                      No player verdicts yet · claim clock running since {row.clockSince}
                    </div>
                  )}
                </div>
              </div>
            ))}
            </div>
          </section>
        ) : null}

        {/* From the wire — dated third-party coverage; discovery time never shown as age */}
        {wire.length > 0 ? (
          <section id="wire" className="brief-band" aria-label="From the wire">
            <div className="brief-band__header">
              <h2 className="dispatch-kicker">{sectionNo("wire")} · From The Wire</h2>
              <span className="brief-band__note dispatch-desktop-only">
                Reviewed coverage on {patch.version}, dated by the source.
              </span>
            </div>
            <div className="wire-grid">
              {wire.map((observation, index) => (
                <article
                  key={observation.id}
                  className={index === 0 ? "wire-item" : "wire-item wire-item--overflow"}
                >
                  <p className="wire-item__meta">
                    {observation.sourceDomain ?? "source"} · {shortDate(observation.sourcePublishedAt)}
                  </p>
                  <a
                    className="wire-item__title"
                    href={observation.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {observation.title}
                  </a>
                  {observation.snippet ? <p className="wire-item__summary">{observation.snippet}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Community asks — a first-class contextual lane, never mixed with coverage */}
        {asks.length > 0 ? (
          <section id="asks" className="brief-band" aria-label="Community asks">
            <div className="brief-band__header">
              <h2 className="dispatch-kicker">{sectionNo("asks")} · Community Asks</h2>
              <span className="brief-band__note dispatch-desktop-only">
                What players are asking Pearl Abyss for — requests, not bug reports.
              </span>
            </div>
            <div className="wire-grid">
              {asks.map((observation, index) => (
                <article
                  key={observation.id}
                  className={index === 0 ? "wire-item" : "wire-item wire-item--overflow"}
                >
                  <p className="wire-item__meta">
                    {observation.sourceDomain ?? "source"} · {shortDate(observation.sourcePublishedAt)}
                    {observation.seenCount > 1 ? ` · seen ${observation.seenCount}×` : ""}
                  </p>
                  <a
                    className="wire-item__title"
                    href={observation.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {observation.title}
                  </a>
                  {observation.snippet ? <p className="wire-item__summary">{observation.snippet}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Observatory footnote — the page's only box */}
        <div className="dispatch-inset-box observatory-footnote surface-raised">
          <div>
            <p className="observatory-footnote__label">From the Observatory</p>
            <p className="observatory-footnote__copy dispatch-desktop-only">
              The radar reviewed <span className="num-ink">{radar.reviewedThisWeek}</span> public candidates this
              week, kept <span className="num-ink">{radar.keptThisWeek}</span>, published{" "}
              <span className="num-ink">{radar.published}</span>.
            </p>
            <p className="observatory-footnote__copy dispatch-mobile-only">
              Radar this week: <span className="num-ink">{radar.reviewedThisWeek}</span> reviewed ·{" "}
              <span className="num-ink">{radar.keptThisWeek}</span> kept
            </p>
          </div>
          <span className="observatory-footnote__link">
            <Link href="/scanner" className="dispatch-link">
              Visit the Observatory →
            </Link>
          </span>
        </div>
      </div>
    </PublicShell>
  );
}
