import Link from "next/link";
import { PatchTimeline } from "@/components/PatchTimeline";
import { RadarFunnel } from "@/components/RadarFunnel";
import { ScannerActivityChart } from "@/components/ScannerActivityChart";
import { CategorySplit, ConfidenceMix, DomainLanes } from "@/components/SourceLandscape";
import { TelemetryBand } from "@/components/TelemetryBand";
import { ReadoutMark } from "@/components/ui";
import { buildFixScoreboard } from "@/lib/fixScoreboard";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { getObservatoryData } from "@/lib/telemetry.server";
import { buildRightNowReadout } from "@/lib/rightNow";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { hasClusterEvidence } from "@/lib/evidence";
import { PEARL_ABYSS_SUPPORT_URL, SOURCE_URL } from "@/lib/site";

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

function latestScanWorkSummary(run: {
  status: string;
  search_results_seen: number;
  reddit_posts_seen: number;
  signals_inserted: number;
  search_queries_used: number;
  signals_reobserved?: number;
  stale_signals_hidden?: number;
}): string {
  const persisted = run.status === "success" || run.status === "partial";
  const reviewed = run.search_results_seen + run.reddit_posts_seen;
  const keptCopy =
    persisted && run.signals_inserted > 0
      ? `${run.signals_inserted} mentions kept`
      : persisted
        ? "no new published links"
        : "no persisted links";
  const parts = [`${run.status}`, `${reviewed} sources reviewed`, keptCopy];
  if (persisted && (run.signals_reobserved ?? 0) > 0) parts.push(`${run.signals_reobserved} re-observed`);
  if (persisted && (run.stale_signals_hidden ?? 0) > 0) parts.push(`${run.stale_signals_hidden} stale hidden`);
  if (run.search_queries_used === 0) parts.push("search skipped this run");
  return parts.join(" · ");
}

function publishedDate(iso: string | null): string {
  if (!iso) return "Publish time not stored yet.";
  return `Published ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(iso),
  )}`;
}

export default async function DashboardPage() {
  const [d, radar, observatory] = await Promise.all([
    getDashboardData(),
    getPublicScannerData(),
    getObservatoryData(),
  ]);
  const reportedIssues = d.topClusters.filter(hasClusterEvidence).length;
  const playerTaps = d.topClusters.reduce((sum, cluster) => sum + cluster.confirmations.totalCount, 0);
  const radarLeadCount = d.topClusters.reduce((sum, cluster) => sum + cluster.candidateSignalCount, 0);
  const currentPatchLabel = `Patch ${d.currentPatch.version}`;
  const readout = buildRightNowReadout({
    currentPatch: d.currentPatch,
    scanner: radar,
    directReports: d.directReports,
    communitySignals: d.communitySignals,
    publicFindingsCount: d.communitySignals,
    latestReportAt: d.latestReportAt,
    topClusters: d.topClusters.map((cluster) => ({
      ...cluster,
      confirmationCount: cluster.confirmations.totalCount,
    })),
    sourceUrl: SOURCE_URL,
    supportUrl: PEARL_ABYSS_SUPPORT_URL,
  });
  const currentIssueReadout = readout.worthChecking[0] ?? null;
  const scannerStatusText = radar.scannerConnected
    ? radar.scannerActive
      ? "Scanner scheduled"
      : "Scanner paused"
    : "Scanner unavailable";
  const scannerStatusTone = radar.scannerConnected
    ? radar.scannerActive
      ? "var(--green-bright)"
      : "var(--amber-bright)"
    : "var(--text-faint)";
  const scannerStatusDot = radar.scannerConnected
    ? radar.scannerActive
      ? "var(--green)"
      : "var(--amber)"
    : "var(--text-faint)";
  const platformEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);
  const categoryEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const maxPlatform = Math.max(...platformEntries.map(([, count]) => count), 1);
  const maxCategory = Math.max(...categoryEntries.map(([, count]) => count), 1);
  const maxRejectionReason = Math.max(...observatory.rejectionReasons.map((reason) => reason.count), 1);
  const hasTelemetry = observatory.totals.scans > 0;
  const scoreboard = buildFixScoreboard({
    claims: d.claimedFixes,
    clusters: d.topClusters,
    patchVersion: d.currentPatch.version,
  });
  const visibleClaims = d.claimedFixes.slice(0, 8);
  const OBSERVATION_KIND_LABELS: Record<(typeof d.observations)[number]["kind"], string> = {
    patch_release: "Patch coverage",
    press_reception: "Press",
    fix_announcement: "Fix talk",
    community_ask: "Community ask",
  };
  const communityAsks = d.observations.filter((observation) => observation.kind === "community_ask");
  const coverageObservations = d.observations.filter((observation) => observation.kind !== "community_ask");
  const askCampaignDay = (title: string): string | null =>
    title.match(/day\s+(\d+)\s+of\s+asking/i)?.[1] ?? null;

  return (
    <div className="page-stack patch-brief-page">
      <section className="brief-hero rise">
        <div className="brief-hero__copy">
          <div className="eyebrow-row">
            <span className="eyebrow">Independent player intelligence</span>
            <span className="status-inline" style={{ color: scannerStatusTone }}>
              <span aria-hidden="true" className="status-inline__dot" style={{ background: scannerStatusDot }} />
              {scannerStatusText}
            </span>
          </div>
          <h1 className="editorial-title">Crimson Desert Report Hub</h1>
          <h2 className="brief-hero__title">Patch Brief</h2>
          <p className="brief-hero__description">
            A clear read on what players are reporting, what public sources are saying, and what still needs proof.
            No ads, no invented counts, no clickbait.
          </p>
          <div className="brief-facts" aria-label="Current patch summary">
            <span>
              <strong className="num">{currentPatchLabel}</strong>
            </span>
            <span>
              <strong className="num">{d.directReports}</strong> player reports
            </span>
            <span>
              <strong className="num">{d.communitySignals}</strong> public source leads
            </span>
            <span>
              <strong className="num">{playerTaps}</strong> player taps
            </span>
            <span>{d.latestReportAt ? `latest player report ${timeAgo(d.latestReportAt)}` : "no player reports yet"}</span>
          </div>
        </div>

        <aside className="brief-index" aria-label="Current patch edition">
          <div className="eyebrow">Current edition</div>
          <div className="brief-index__version num">{d.currentPatch.version}</div>
          <p>{d.currentPatch.title}</p>
          <p className="brief-index__date">{publishedDate(d.currentPatch.publishedAt)}</p>
          <a
            href={d.currentPatch.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="link brief-index__link"
            aria-label="Official notes"
          >
            Official notes ↗
          </a>
        </aside>
      </section>

      {hasTelemetry ? (
        <section className="brief-section brief-section--band" aria-label="Scanner telemetry across all patches">
          <TelemetryBand data={observatory} />
        </section>
      ) : null}

      <section className="signal-rail" aria-labelledby="right-now-title">
        <div className="signal-rail__label">
          <span className="signal-rail__index num">01</span>
          <span className="eyebrow">Live brief</span>
          <span className="signal-rail__pulse" aria-hidden="true" />
          <span className="signal-rail__label-name">Right now</span>
        </div>
        <div className="signal-rail__body">
          <div className="signal-rail__bodyline">
            <span style={{ color: "var(--text-dim)" }}>Current patch</span>
            <span aria-hidden="true">·</span>
            <span>{d.latestReportAt ? `Updated ${timeAgo(d.latestReportAt)}` : "Awaiting first report"}</span>
          </div>
          <h2 id="right-now-title">{readout.snapshotLine}</h2>
          <p>
            {currentIssueReadout
              ? `Current issue readout — ${currentIssueReadout.title}: ${currentIssueReadout.detail}`
              : `Current issue readout — ${readout.emptyWorthCheckingCopy}`}
          </p>
        </div>
        <div className="signal-rail__context" aria-label="Current signal context">
          <div className="signal-context-cell">
            <span className="eyebrow">Reports</span>
            <strong className="num">{d.directReports}</strong>
            <span>player evidence</span>
          </div>
          <div className="signal-context-cell">
            <span className="eyebrow">Links</span>
            <strong className="num">{d.communitySignals}</strong>
            <span>public source leads</span>
          </div>
          <div className="signal-context-cell">
            <span className="eyebrow">Radar</span>
            <strong className="num">{radar.awaiting}</strong>
            <span>awaiting corroboration</span>
          </div>
        </div>
        <div className="signal-rail__actions">
          <span className="signal-rail__scan-status">
            {/* The hero already carries the colored status light; here it reads as telemetry. */}
            <span className="signal-rail__meta-copy">
              {d.latestAutomationRun
                ? `${scannerStatusText} · Last scan ${timeAgo(d.latestAutomationRun.finished_at)} · ${latestScanWorkSummary(d.latestAutomationRun)}`
                : `${scannerStatusText} · No scheduled scan recorded yet.`}
            </span>
          </span>
          <div className="signal-rail__links">
            <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="link">
              Official notes
            </a>
            <a href={PEARL_ABYSS_SUPPORT_URL} target="_blank" rel="noreferrer noopener" className="link">
              Pearl Abyss support
            </a>
            <Link href="/scanner" className="link">
              Source Radar
            </Link>
          </div>
        </div>
      </section>

      <section className="brief-section" aria-labelledby="at-a-glance-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">At a glance</div>
            <h2 id="at-a-glance-title">The patch in four signals</h2>
          </div>
          <p>Counts stay literal. A quiet board is still a real result.</p>
        </div>
        <div className="metric-strip">
          <article className="metric-card metric-card--crimson">
            <div className="eyebrow">Player-reported issues</div>
            <div className="metric-card__value num">{reportedIssues}</div>
            <p>{d.directReports === 0 ? "No structured reports this patch" : `${d.directReports} structured reports`}</p>
          </article>
          <article className="metric-card metric-card--crimson">
            <div className="eyebrow">Player reports</div>
            <div className="metric-card__value num">{d.directReports}</div>
            <p>{d.directReports === 0 ? "No reports this patch" : `+${d.weekDelta} this week`}</p>
          </article>
          <article className="metric-card metric-card--amber">
            <div className="eyebrow">Fix claims · players verify</div>
            <div className="metric-card__value num">{d.topClusters.filter((cluster) => cluster.readout.poll !== null).length}</div>
            <p>{d.topClusters.some((cluster) => cluster.readout.poll !== null) ? "PA says fixed; taps decide" : "No open fix claims"}</p>
          </article>
          <article className="metric-card metric-card--blue">
            <div className="eyebrow">Radar leads</div>
            <div className="metric-card__value num">{radarLeadCount}</div>
            <p>Rumors with links — not evidence</p>
          </article>
        </div>
      </section>

      {scoreboard ? (
        <section className="brief-section" aria-labelledby="scoreboard-title">
          <div className="section-intro">
            <div>
              <div className="eyebrow">The scoreboard</div>
              <h2 id="scoreboard-title">Fix claims, player verdicts</h2>
            </div>
            <p>Pearl Abyss says fixed. Players confirm, contest, or stay quiet — the board never decides for them.</p>
          </div>
          <div className="content-grid content-grid--wide">
            <article className="chart-card chart-card--wide">
              <div className="chart-card__header">
                <div>
                  <h3>What {d.currentPatch.version} claims to fix</h3>
                  <p>
                    Official wording, counted literally — <span className="num">{scoreboard.totalClaims}</span>{" "}
                    {scoreboard.totalClaims === 1 ? "claimed fix" : "claimed fixes"} in the patch notes.
                  </p>
                </div>
                <a
                  href={d.currentPatch.officialUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="link text-xs"
                >
                  Official notes ↗
                </a>
              </div>
              {scoreboard.totalClaims === 0 ? (
                <p className="chart-empty chart-empty--short">No claimed fixes parsed from this patch yet.</p>
              ) : (
                <>
                  <div className="mt-3 divide-y">
                    {visibleClaims.map((claim, index) => (
                      <div key={index} className="py-2.5 first:pt-0">
                        <div className="stat-label">
                          {CATEGORY_LABELS[claim.category as keyof typeof CATEGORY_LABELS] ?? "General"}
                        </div>
                        <p className="mt-1 max-w-prose text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                          {claim.fixText}
                        </p>
                      </div>
                    ))}
                  </div>
                  {d.claimedFixes.length > visibleClaims.length ? (
                    <p className="muted-note">
                      +{d.claimedFixes.length - visibleClaims.length} more in the official notes.
                    </p>
                  ) : null}
                </>
              )}
            </article>
            <article className="chart-card">
              <div className="chart-card__header">
                <div>
                  <h3>What players say</h3>
                  <p>Verdicts come only from player taps on watched issues that carry this patch&rsquo;s fix claim.</p>
                </div>
              </div>
              {scoreboard.verifying.length === 0 ? (
                <p className="chart-empty chart-empty--short">
                  No claim maps to a watched issue yet. Quiet can mean fixed — or just quiet.
                </p>
              ) : (
                <div className="mt-3 divide-y">
                  {scoreboard.verifying.map((row) => (
                    <div key={row.slug} className="py-3 first:pt-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="min-w-0 text-sm font-semibold">{row.title}</p>
                        <ReadoutMark label={row.label} tone={row.tone} />
                      </div>
                      <p className="num mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                        {row.fixedCount + row.stillCount > 0
                          ? `${row.fixedCount} say fixed · ${row.stillCount} say still happening`
                          : "awaiting player taps"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="card-rule" />
              <Link href="/issues" className="link text-xs">
                Add your verdict on the issue board ↗
              </Link>
            </article>
          </div>
        </section>
      ) : null}

      {coverageObservations.length > 0 ? (
        <section className="brief-section" aria-labelledby="observations-title">
          <div className="section-intro">
            <div>
              <div className="eyebrow">Around the patch</div>
              <h2 id="observations-title">What the internet is saying</h2>
            </div>
            <p>
              Reviewed coverage from trusted domains, shown verbatim. Observations are context — they never count as
              evidence and never touch issue numbers.
            </p>
          </div>
          <div className="observation-list">
            {coverageObservations.map((observation) => (
              <a
                key={observation.id}
                href={observation.url}
                target="_blank"
                rel="noreferrer noopener"
                className="observation-row"
              >
                <div className="observation-row__meta">
                  <span className="readout-mark readout-mark--dim">
                    Observation · {OBSERVATION_KIND_LABELS[observation.kind]}
                  </span>
                  <span className="num">{observation.sourceDomain ?? "unknown source"}</span>
                  <span>{timeAgo(observation.observedAt)}</span>
                  {observation.seenCount > 1 ? (
                    <span className="num">seen {observation.seenCount}×</span>
                  ) : null}
                </div>
                <strong>{observation.title}</strong>
                {observation.snippet ? <p>{observation.snippet}</p> : null}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {communityAsks.length > 0 ? (
        <section className="brief-section" aria-labelledby="community-asks-title">
          <div className="section-intro">
            <div>
              <div className="eyebrow">Community pulse</div>
              <h2 id="community-asks-title">What players are asking for</h2>
            </div>
            <p>
              Requests and campaigns the scanner keeps seeing, shown verbatim. Wanting something is not a bug —
              these never touch evidence counts.
            </p>
          </div>
          <div className="observation-list">
            {communityAsks.map((observation) => {
              const campaignDay = askCampaignDay(observation.title);
              return (
                <a
                  key={observation.id}
                  href={observation.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="observation-row"
                >
                  <div className="observation-row__meta">
                    <span className="readout-mark readout-mark--dim">Community ask</span>
                    <span className="num">{observation.sourceDomain ?? "unknown source"}</span>
                    <span>{timeAgo(observation.observedAt)}</span>
                    {campaignDay ? (
                      <span className="num" style={{ color: "var(--amber-bright)" }}>
                        day {campaignDay} campaign
                      </span>
                    ) : null}
                    {observation.seenCount > 1 ? (
                      <span className="num">seen {observation.seenCount}×</span>
                    ) : null}
                  </div>
                  <strong>{observation.title}</strong>
                  {observation.snippet ? <p>{observation.snippet}</p> : null}
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="brief-section" aria-labelledby="highlights-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">The machine at work</div>
            <h2 id="highlights-title">What the scanner did</h2>
          </div>
          <p>
            Daily intake across every patch — the muted bars are everything reviewed, the blue bars are what survived
            screening. Sparse days look sparse on purpose.
          </p>
        </div>
        <div className="highlight-grid">
          <article className="chart-card chart-card--wide">
            <div className="chart-card__header">
              <div>
                <h3>Scanner activity</h3>
                <p>Sources reviewed and signals kept per day, last 30 days.</p>
              </div>
              <span className="badge badge-dim">All patches</span>
            </div>
            {hasTelemetry ? (
              <ScannerActivityChart daily={observatory.daily} />
            ) : (
              <div className="chart-empty">Activity appears once the scanner has run.</div>
            )}
          </article>
          <article className="chart-card">
            <div className="chart-card__header">
              <div>
                <h3>Source radar funnel</h3>
                <p>How public chatter becomes inspectable context.</p>
              </div>
              <Link href="/scanner" className="link text-xs">
                Open radar ↗
              </Link>
            </div>
            <RadarFunnel data={radar} />
            {observatory.rejectionReasons.length > 0 ? (
              <>
                <div className="card-rule" />
                <div className="eyebrow">Why sources get filtered</div>
                <div className="bar-list bar-list--tight">
                  {observatory.rejectionReasons.map((reason) => (
                    <div key={reason.reason} className="bar-list__row">
                      <div className="bar-list__label">
                        <span>{reason.label}</span>
                        <span className="num">{reason.count}</span>
                      </div>
                      <div className="bar-list__track" aria-hidden="true">
                        <span
                          style={{
                            width: `${Math.max(2, Math.round((reason.count / maxRejectionReason) * 100))}%`,
                            background: "var(--border-strong)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="muted-note">
                  Rolling rescue window (about a week) — aggregate counts only, no titles or links.
                </p>
              </>
            ) : null}
          </article>
        </div>
      </section>

      <section className="brief-section" aria-labelledby="landscape-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">Source landscape</div>
            <h2 id="landscape-title">Where signals live</h2>
          </div>
          <p>
            Every domain the radar has touched, and how the screen treated it. Kept means tracked as a lead — still not
            evidence.
          </p>
        </div>
        <div className="content-grid content-grid--wide">
          <article className="chart-card chart-card--wide">
            <div className="chart-card__header">
              <div>
                <h3>Domains: kept vs filtered</h3>
                <p>Signals kept all-time; filtered counts cover the scanner&rsquo;s rolling rescue window.</p>
              </div>
            </div>
            <DomainLanes domains={observatory.domains} />
          </article>
          <article className="chart-card">
            <div className="chart-card__header">
              <div>
                <h3>What signals are about</h3>
                <p>Category mix across tracked signals.</p>
              </div>
            </div>
            <CategorySplit categories={observatory.signalCategories} />
            <div className="card-rule" />
            <div className="eyebrow">Extraction confidence</div>
            <ConfidenceMix mix={observatory.confidenceMix} />
          </article>
        </div>
      </section>

      <section className="brief-section" aria-labelledby="activity-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">The record</div>
            <h2 id="activity-title">Activity and context</h2>
          </div>
          <p>Player evidence and official notes belong in the same brief, but they are never the same thing.</p>
        </div>
        <div className="content-grid content-grid--wide">
          <article className="chart-card chart-card--wide">
            <div className="chart-card__header">
              <div>
                <h3>Patch ledger</h3>
                <p>Every patch the hub has covered — cadence, claimed fixes, player verdicts.</p>
              </div>
              <span className="badge badge-dim">All patches</span>
            </div>
            <PatchTimeline patches={observatory.patches} />
          </article>
          <article className="source-card">
            <div className="source-card__topline">
              <div className="eyebrow">Source document</div>
              <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="link text-xs">
                Official notes ↗
              </a>
            </div>
            <h3>Official patch source</h3>
            <p className="source-card__document">{d.currentPatch.title}</p>
            <p className="source-card__summary">
              {d.currentPatch.summary ??
                "Official notes provide patch context. The board itself is driven by player reports, confirmation signals, and corroborated source leads."}
            </p>
            <div className="source-card__date">{publishedDate(d.currentPatch.publishedAt)}</div>
          </article>
        </div>
      </section>

      <section className="brief-section" aria-labelledby="coverage-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">Coverage</div>
            <h2 id="coverage-title">Where the signal is coming from</h2>
          </div>
          <p>These breakdowns stay intentionally small until reports give them something honest to say.</p>
        </div>
        <div className="content-grid">
          <article className="chart-card">
            <div className="chart-card__header">
              <div>
                <h3>Player evidence</h3>
                <p>Approved reports for this patch — counted literally, never padded.</p>
              </div>
            </div>
            {platformEntries.length === 0 && categoryEntries.length === 0 ? (
              <p className="chart-empty chart-empty--short">
                No approved reports for {currentPatchLabel} yet. When they land, platform and category splits appear
                here — until then, zero stays zero.
              </p>
            ) : (
              <>
                {platformEntries.length > 0 ? (
                  <div className="bar-list">
                    {platformEntries.map(([platform, count]) => (
                      <div key={platform} className="bar-list__row">
                        <div className="bar-list__label">
                          <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
                          <span className="num">{count}</span>
                        </div>
                        <div className="bar-list__track" aria-hidden="true">
                          <span style={{ width: `${Math.round((count / maxPlatform) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {categoryEntries.length > 0 ? (
                  <div className="bar-list">
                    {categoryEntries.map(([category, count]) => (
                      <div key={category} className="bar-list__row">
                        <div className="bar-list__label">
                          <span>{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}</span>
                          <span className="num">{count}</span>
                        </div>
                        <div className="bar-list__track" aria-hidden="true">
                          <span className="bar-list__track--amber" style={{ width: `${Math.round((count / maxCategory) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            <div className="card-rule" />
            <div className="eyebrow">Most-cited GPUs</div>
            {Object.entries(d.gpus).length === 0 ? (
              <p className="muted-note">Appears once reports include hardware.</p>
            ) : (
              <div className="chip-list">
                {Object.entries(d.gpus)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([gpu, count]) => (
                    <span key={gpu} className="chip">
                      {gpu} <span className="num">{count}</span>
                    </span>
                  ))}
              </div>
            )}
            <div className="card-rule" />
            <p className="muted-note">Reports capture category, severity, frequency, hardware, repro steps, and optional evidence links.</p>
          </article>

          <article className="chart-card feed-card">
            <div className="chart-card__header">
              <div>
                <h3>Latest public signals</h3>
                <p>Reviewed links currently visible on the board.</p>
              </div>
              <Link href="/issues" className="link text-xs">
                View issues ↗
              </Link>
            </div>
            {d.publicFindings.length === 0 ? (
              <p className="chart-empty chart-empty--short">No public source links are displayed for this patch yet.</p>
            ) : (
              <div className="feed-list">
                {d.publicFindings.slice(0, 4).map((finding) => (
                  <a key={finding.id} href={finding.sourceUrl} target="_blank" rel="noreferrer noopener" className="feed-item">
                    <div className="feed-item__meta">
                      <span>{finding.sourceHost}</span>
                      <span>{timeAgo(finding.observedAt)}</span>
                    </div>
                    <strong>{finding.title}</strong>
                    <p>{finding.summary}</p>
                  </a>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="method-note" aria-label="How to read this brief">
        <div className="eyebrow">Read the board correctly</div>
        <p>
          Player reports are evidence. One-tap confirmations are signals. Scanner links are leads. Official notes are context. The tracker never invents counts, and quiet never means fixed.
        </p>
        <div className="method-note__links">
          <Link href="/issues" className="link">Browse issues ↗</Link>
          <Link href="/report" className="link">Submit a report ↗</Link>
          <Link href="/about" className="link">Read the method ↗</Link>
        </div>
      </section>

      <section className="brief-notes" aria-label="Privacy and evidence notes">
        <div>
          <h3>Privacy</h3>
          <p>No accounts, ads, trackers, or raw IP storage. Public text is a neutral generated summary, never your raw words.</p>
        </div>
        <div>
          <h3>Evidence</h3>
          <p>Reports capture platform, severity, frequency, hardware, repro steps, and optional evidence links.</p>
        </div>
        <div>
          <h3>Official channel</h3>
          <p>Crash logs and PERS IDs still belong in Pearl Abyss support. This hub organizes community evidence, signals, and leads.</p>
        </div>
      </section>
    </div>
  );
}
