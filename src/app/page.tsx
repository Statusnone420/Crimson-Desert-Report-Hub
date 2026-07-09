import Link from "next/link";
import { PatchActivityChart } from "@/components/PatchActivityChart";
import { EvidenceLadderBadge, FixStatusBadge, MeterBar, SectionHeader, StatCard } from "@/components/ui";
import { assessClaims } from "@/lib/claims";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import {
  countEvidenceBackedPersistentClusters,
  countUnverifiedClaimedFixWatchlistClusters,
  hasClusterEvidence,
  monitoredAreasNote,
  splitWatchlistByCandidates,
  unconfirmedMentionsNote,
} from "@/lib/evidence";
import { clusterEvidenceState } from "@/lib/evidenceLadder";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { buildRightNowReadout } from "@/lib/rightNow";
import { PEARL_ABYSS_SUPPORT_URL, SOURCE_URL } from "@/lib/site";

export const revalidate = 300;

type Tone = "crimson" | "amber" | "green" | "blue" | "dim";

function timeAgo(iso: string | null): string {
  if (!iso) return "no reports yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusTone(fixStatus: string): Tone {
  if (fixStatus === "persists") return "crimson";
  if (fixStatus === "acknowledged" || fixStatus === "fix_claimed") return "amber";
  if (fixStatus === "verified_fixed") return "green";
  return "dim";
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
        ? "no new public evidence"
        : "no persisted evidence";
  const parts = [
    `${run.status}`,
    `${reviewed} sources reviewed`,
    keptCopy,
  ];
  if (persisted && (run.signals_reobserved ?? 0) > 0) parts.push(`${run.signals_reobserved} re-observed`);
  if (persisted && (run.stale_signals_hidden ?? 0) > 0) parts.push(`${run.stale_signals_hidden} stale hidden`);
  if (run.search_queries_used === 0) parts.push("search skipped this run");
  return parts.join(" · ");
}

export default async function DashboardPage() {
  const [d, radar] = await Promise.all([getDashboardData(), getPublicScannerData()]);
  const persistentCount = countEvidenceBackedPersistentClusters(d.topClusters);
  const claimedFixWatchlistCount = countUnverifiedClaimedFixWatchlistClusters(d.topClusters);
  const active = d.topClusters.filter(hasClusterEvidence);
  const watchlist = d.topClusters.filter((cluster) => !hasClusterEvidence(cluster));
  const { candidates, monitored } = splitWatchlistByCandidates(watchlist);
  const maxStrength = Math.max(...active.map((cluster) => cluster.strengthScore), 1);
  const platformEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);
  const gpuEntries = Object.entries(d.gpus).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const categoryEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const maxPlatform = Math.max(...platformEntries.map(([, n]) => n), 1);
  const patchLabel = `Patch ${d.currentPatch.version}`;
  const pendingMentions = d.topClusters.reduce((sum, cluster) => sum + cluster.candidateSignalCount, 0);
  const claims = assessClaims(d.claimedFixes, d.topClusters);
  const disputedClaims = claims.disputed.filter((claim) => claim.cluster);
  const hasActivity = d.series.some((point) => point.count > 0) || d.signalSeries.some((point) => point.count > 0);
  const readout = buildRightNowReadout({
    currentPatch: d.currentPatch,
    scanner: radar,
    directReports: d.directReports,
    communitySignals: d.communitySignals,
    publicFindingsCount: d.communitySignals,
    latestReportAt: d.latestReportAt,
    topClusters: d.topClusters,
    sourceUrl: SOURCE_URL,
    supportUrl: PEARL_ABYSS_SUPPORT_URL,
  });
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

  return (
    <div className="space-y-6">
      <section className="rise grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2.5">
          <h1 className="h-display max-w-3xl">Crimson Desert Report Hub</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Current situation for Crimson Desert: backed issues, scanner signals, source links, and what looks worth
            checking.
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs" style={{ color: "var(--text-faint)" }}>
            <span className="num" style={{ color: "var(--text-dim)" }}>{active.length}</span> backed issues
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.directReports}</span> reports
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.communitySignals}</span> public signals
            <span aria-hidden="true">·</span>
            {d.latestReportAt ? `latest player report ${timeAgo(d.latestReportAt)}` : "no player reports yet"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 md:justify-end">
          <a
            href={d.currentPatch.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="badge badge-crimson"
            aria-label={`Open official ${patchLabel} notes`}
          >
            {patchLabel}
          </a>
          <Link href="/report" className="btn">
            Submit a report
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rise" style={{ animationDelay: "40ms" }}>
          <StatCard
            label="Evidence-backed issues"
            value={active.length}
            note={persistentCount > 0 ? `${persistentCount} persist after claimed fixes` : "Reports or public signals"}
            tone={persistentCount > 0 ? "crimson" : "green"}
          />
        </div>
        <div className="rise" style={{ animationDelay: "80ms" }}>
          <StatCard
            label="Player reports"
            value={d.directReports}
            note={d.directReports === 0 ? "be the first" : `+${d.weekDelta} this week`}
            tone="crimson"
          />
        </div>
        <div className="rise" style={{ animationDelay: "120ms" }}>
          <StatCard
            label="Public signals"
            value={d.communitySignals}
            note={d.communitySignals === 0 ? "None public yet" : "Links visible on issues"}
            tone="blue"
          />
        </div>
        <div className="rise" style={{ animationDelay: "160ms" }}>
          <StatCard
            label="Awaiting corroboration"
            value={pendingMentions}
            note={claimedFixWatchlistCount > 0 ? `${claimedFixWatchlistCount} claimed-fix watch items` : "Needs another source"}
            tone="amber"
          />
        </div>
      </section>

      <section className="panel-inset flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-sm">
        <div className="min-w-0 space-y-1.5" style={{ color: "var(--text-dim)" }}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="badge badge-blue">Right now</span>
            <span>{readout.snapshotLine}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: "var(--text-faint)" }}>
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: scannerStatusTone }}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: scannerStatusDot }} />
              {scannerStatusText}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {d.latestAutomationRun
                ? `Last scan ${timeAgo(d.latestAutomationRun.finished_at)} · ${latestScanWorkSummary(d.latestAutomationRun)}`
                : "No scheduled scan recorded yet."}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm">
            Official notes
          </a>
          <a href={PEARL_ABYSS_SUPPORT_URL} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm">
            Pearl Abyss support
          </a>
          <Link href="/scanner" className="btn btn-ghost btn-sm">
            Source Radar
          </Link>
        </div>
      </section>

      {disputedClaims.length > 0 ? (
        <section className="panel space-y-4">
          <SectionHeader
            label={`${patchLabel} context`}
            title="Still reported after claimed fix"
            description="Official notes are context. This section appears only when a claimed fix overlaps active community evidence."
            action={
              <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="link text-xs">
                Official notes ↗
              </a>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            {disputedClaims.slice(0, 4).map((claim, index) => (
              <article
                key={index}
                className="panel-inset space-y-2 border p-3"
                style={{ borderColor: "var(--crimson-edge)", background: "var(--crimson-tint)" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="badge badge-crimson">Evidence still active</span>
                  <Link href="/issues" className="link text-xs">
                    View evidence
                  </Link>
                </div>
                <p className="text-sm leading-6">{claim.cluster?.title}</p>
                <p className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                  Claimed fix: {claim.fixText}
                </p>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  <span className="num">{claim.cluster?.directReportCount ?? 0}</span> approved reports ·{" "}
                  <span className="num">{claim.cluster?.signalCount ?? 0}</span> public signals
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="panel space-y-5">
          <SectionHeader
            title={active.length > 0 ? "Top issues this patch" : "Nothing backed by evidence yet"}
            description={
              active.length > 0
                ? "Ranked by approved reports and public signals."
                : "Known problem areas stay quiet until a player report or public source backs them."
            }
            action={
              <Link href="/issues" className="btn btn-ghost btn-sm">
                All issues
              </Link>
            }
          />

          {active.length > 0 ? (
            <div className="space-y-4">
              {active.slice(0, 6).map((cluster) => (
                <Link key={cluster.id} href="/issues" className="block space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{cluster.title}</span>
                      <FixStatusBadge status={cluster.fix_status} />
                    </span>
                    <span className="num ml-auto shrink-0 text-xs" style={{ color: "var(--text-dim)" }}>
                      {cluster.directReportCount} reports · {cluster.signalCount} signals
                    </span>
                  </div>
                  <MeterBar value={cluster.strengthScore} max={maxStrength} tone={statusTone(cluster.fix_status)} />
                </Link>
              ))}
            </div>
          ) : null}

          {candidates.length > 0 || monitored.length > 0 ? (
            <div className="space-y-2.5">
              {active.length > 0 ? <div className="stat-label pt-1">Also watching</div> : null}
              {candidates.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {candidates.map((cluster) => (
                    <Link
                      key={cluster.id}
                      href="/issues"
                      className="panel-inset interactive block space-y-1.5 border px-3 py-2.5"
                    >
                      <p className="truncate text-sm font-medium">{cluster.title}</p>
                      <div className="flex items-center justify-between gap-2">
                        <EvidenceLadderBadge
                          state={clusterEvidenceState({
                            directReportCount: cluster.directReportCount,
                            publicSignalCount: cluster.signalCount,
                            candidateSignalCount: cluster.candidateSignalCount,
                          })}
                        />
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                          {CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "var(--blue)" }}>
                        {unconfirmedMentionsNote(cluster.candidateSignalCount)}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : null}
              {monitored.length > 0 ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }} title="The scanner checks public sources each run.">
                  {monitoredAreasNote(monitored.length)}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="border-t pt-3 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
            Watchlist clusters start unverified at zero. They become evidence only after approved reports or public
            signals confirm them; the tracker never invents counts.
          </p>
        </div>

        <div className="space-y-3">
          <div className="panel space-y-3">
            <div className="stat-label">Platforms</div>
            {platformEntries.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                No approved reports yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {platformEntries.map(([platform, count]) => (
                  <div key={platform} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
                      <span className="num text-xs" style={{ color: "var(--text-dim)" }}>{count}</span>
                    </div>
                    <MeterBar value={count} max={maxPlatform} tone="dim" />
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-3">
              <div className="stat-label mb-2">Most-cited GPUs</div>
              {gpuEntries.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  Appears once reports include hardware.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {gpuEntries.map(([gpu, count]) => (
                    <span key={gpu} className="chip">
                      {gpu}
                      <span className="num" style={{ color: "var(--text-faint)" }}>{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel space-y-2">
            <div className="stat-label">By category</div>
            {categoryEntries.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                Counts appear as reports are sorted.
              </p>
            ) : (
              <div className="space-y-1">
                {categoryEntries.map(([category, count]) => (
                  <div key={category} className="flex items-center justify-between py-1 text-sm">
                    <span style={{ color: "var(--text-dim)" }}>
                      {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}
                    </span>
                    <span className="num text-xs">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-[1.35fr_0.9fr]">
        <div className="panel">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="h-section">30-day patch activity</h2>
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                Approved reports and public signals over time.
              </p>
            </div>
            <span className="badge badge-dim">Current patch</span>
          </div>
          {hasActivity ? (
            <PatchActivityChart reports={d.series} signals={d.signalSeries} />
          ) : (
            <div className="flex h-28 items-center justify-center text-xs" style={{ color: "var(--text-faint)" }}>
              Activity appears once approved reports or public signals come in.
            </div>
          )}
        </div>

        <div className="panel space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="h-section">Official patch source</h2>
            <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="link text-xs">
              Official notes ↗
            </a>
          </div>
          <p className="text-sm font-medium">{d.currentPatch.title}</p>
          <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {d.currentPatch.summary ??
              "Official notes provide the patch label and source context. The board itself is driven by player reports and public evidence."}
          </p>
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {d.currentPatch.publishedAt
              ? `Published ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(d.currentPatch.publishedAt))}`
              : "Publish time not stored yet."}
          </p>
        </div>
      </section>

      <section className="grid gap-4 border-t pt-5 md:grid-cols-3 md:gap-6">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Privacy</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            No accounts, ads, trackers, or raw IP storage. Public text is a neutral generated summary, never your raw
            words.
          </p>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Evidence</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Reports capture platform, severity, frequency, hardware, repro steps, and optional evidence links.
          </p>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Official channel</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Crash logs and PERS IDs still belong in Pearl Abyss support. This hub organizes the community signal.
          </p>
        </div>
      </section>
    </div>
  );
}
