import Link from "next/link";
import { PatchActivityChart } from "@/components/PatchActivityChart";
import { EvidenceLadderBadge, MeterBar, SectionHeader, StatCard } from "@/components/ui";
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
import { playerIssueStatus, type PlayerIssueStatus } from "@/lib/patchWatch";
import { getDashboardData, getPublicScannerData } from "@/lib/queries";
import { SOURCE_URL } from "@/lib/site";

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

function statusBadgeClass(tone: PlayerIssueStatus["tone"]): string {
  if (tone === "crimson") return "badge badge-crimson";
  if (tone === "amber") return "badge badge-amber";
  if (tone === "green") return "badge badge-green";
  if (tone === "blue") return "badge badge-blue";
  return "badge badge-dim";
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
  const publicFindings = d.publicFindings;
  const pendingMentions = d.topClusters.reduce((sum, cluster) => sum + cluster.candidateSignalCount, 0);
  const claims = assessClaims(d.claimedFixes, d.topClusters);
  const radarStatusLabel = radar.scannerConnected
    ? radar.scannerActive
      ? `last scan ${timeAgo(radar.lastCheckedAt)}`
      : "scanner paused"
    : "scanner not connected";
  const radarStatusClass = radar.scannerConnected
    ? radar.scannerActive
      ? "badge badge-green badge-dot"
      : "badge badge-amber badge-dot"
    : "badge badge-dim badge-dot";
  const patchWatchItems = claims.all.slice(0, 6).map((claim) => {
    const cluster = claim.cluster;
    const status = playerIssueStatus({
      directReportCount: cluster?.directReportCount ?? 0,
      publicSignalCount: cluster?.signalCount ?? 0,
      candidateSignalCount: cluster?.candidateSignalCount ?? 0,
      postCurrentPatchEvidenceCount: cluster?.postCurrentPatchEvidenceCount ?? 0,
      fixStatus: "fix_claimed",
    });
    return { ...claim, status };
  });
  const hasActivity = d.series.some((point) => point.count > 0) || d.signalSeries.some((point) => point.count > 0);

  return (
    <div className="space-y-6">
      <section className="rise grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2.5">
          <h1 className="h-display max-w-3xl">Crimson Desert Report Hub</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Patch web radar and evidence board for Crimson Desert. It aggregates public chatter, official context,
            useful links, and player reports without pretending thin data is proof.
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs" style={{ color: "var(--text-faint)" }}>
            <span className="num" style={{ color: "var(--text-dim)" }}>{active.length}</span> backed issues
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.directReports}</span> reports
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.communitySignals}</span> public signals
            <span aria-hidden="true">·</span>
            {d.latestReportAt ? `latest report ${timeAgo(d.latestReportAt)}` : "no reports yet"}
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

      <section className="panel space-y-4">
        <SectionHeader
          label={`${patchLabel} web radar`}
          title="What can be learned without waiting for reports"
          description="The scanner keeps watching public sources even if nobody submits anything here. Public links show when they clear the evidence rules; private leads stay counted, not exposed."
          action={
            <Link href="/scanner" className="btn btn-ghost btn-sm">
              Source Radar
            </Link>
          }
        />

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="panel-inset border p-3">
            <div className="stat-label">Reviewed this week</div>
            <div className="stat-value mt-1" style={{ fontSize: "1.65rem", color: "var(--green-bright)" }}>
              {radar.reviewedThisWeek}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              public candidates checked
            </p>
          </div>
          <div className="panel-inset border p-3">
            <div className="stat-label">Filtered noise</div>
            <div className="stat-value mt-1" style={{ fontSize: "1.65rem", color: "var(--amber-bright)" }}>
              {radar.filteredThisWeek}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              patch notes, stale, off-topic
            </p>
          </div>
          <div className="panel-inset border p-3">
            <div className="stat-label">Private leads</div>
            <div className="stat-value mt-1" style={{ fontSize: "1.65rem", color: "var(--blue)" }}>
              {radar.awaiting}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              not enough to publish
            </p>
          </div>
          <div className="panel-inset border p-3">
            <div className="stat-label">Public findings</div>
            <div className="stat-value mt-1" style={{ fontSize: "1.65rem", color: "var(--crimson-bright)" }}>
              {publicFindings.length}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              source links visible
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.8fr]">
          <div className="panel-inset space-y-3 border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Public web findings</h2>
              <span className={radarStatusClass}>{radarStatusLabel}</span>
            </div>
            {publicFindings.length > 0 ? (
              <div className="space-y-3">
                {publicFindings.slice(0, 4).map((finding) => (
                  <article key={finding.id} className="border-t pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={finding.confidence === "high" ? "badge badge-green" : finding.confidence === "medium" ? "badge badge-amber" : "badge badge-dim"}>
                        {finding.confidence} confidence
                      </span>
                      <span className="num" style={{ color: "var(--text-faint)" }}>
                        {finding.sourceHost}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold">{finding.title}</h3>
                    <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                      {finding.summary}
                    </p>
                    <a href={finding.sourceUrl} target="_blank" rel="noreferrer noopener" className="link text-xs">
                      Open source
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                {radar.scannerConnected
                  ? `No source links are public yet for this patch. That does not mean nothing is happening: the scanner is holding ${radar.awaiting} private ${radar.awaiting === 1 ? "lead" : "leads"} until another source or a player report makes them safe to show.`
                  : "This local build is not connected to the scanner database, so public source links are unavailable here. The official notes, evidence rules, scanner funnel, and source code links still explain what the hub is watching and how the data is handled."}
              </p>
            )}
          </div>

          <div className="panel-inset space-y-3 border p-3">
            <h2 className="text-sm font-semibold">Useful next clicks</h2>
            <div className="grid gap-2">
              <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm justify-start">
                Official patch notes
              </a>
              <Link href="/issues" className="btn btn-ghost btn-sm justify-start">
                Evidence board
              </Link>
              <Link href="/scanner" className="btn btn-ghost btn-sm justify-start">
                Scanner funnel
              </Link>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm justify-start">
                Open-source code
              </a>
            </div>
            <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              Reports make the signal stronger, but the site should still be useful as a transparent public-source radar.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.35fr_0.9fr]">
        <div className="panel space-y-4">
          <SectionHeader
            label="Evidence board status"
            title={active.length > 0 ? "What has enough backing to track" : "No evidence-backed issue yet"}
            description={
              active.length > 0
                ? "These are the issues with approved reports or publishable public sources. The counts show how early the signal still is."
                : `The radar can still be useful, but the stricter evidence board needs an approved report or publishable source before it promotes a topic.`
            }
            action={
              <Link href="/report" className="btn btn-sm">
                Report an issue
              </Link>
            }
          />

          {active.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {active.slice(0, 4).map((cluster) => {
                const status = playerIssueStatus({
                  directReportCount: cluster.directReportCount,
                  publicSignalCount: cluster.signalCount,
                  candidateSignalCount: cluster.candidateSignalCount,
                  postCurrentPatchEvidenceCount: cluster.postCurrentPatchEvidenceCount,
                  fixStatus: cluster.fix_status,
                });
                return (
                  <Link key={cluster.id} href="/issues" className="panel-inset interactive block space-y-2 border px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium">{cluster.title}</p>
                      <span className={statusBadgeClass(status.tone)}>{status.label}</span>
                    </div>
                    <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                      {status.strengthLabel}. {status.detail}
                    </p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="panel-inset border px-3 py-3">
              <p className="text-sm font-medium">Help turn chatter into evidence.</p>
              <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                One report with platform, severity, hardware, and repro detail is more useful to players than a pile of
                scraped links. Raw words stay private; the public board shows neutral summaries and counts.
              </p>
            </div>
          )}
        </div>

        <div className="panel space-y-4">
          <SectionHeader
            label="Needs confirmation"
            title={candidates.length > 0 ? "Patterns to verify" : "Known watchlist is quiet"}
            description="Private scanner candidates are a lead, not proof. They need a player report or a source that can be shown publicly."
          />
          {candidates.length > 0 ? (
            <div className="space-y-2">
              {candidates.slice(0, 3).map((cluster) => (
                <div key={cluster.id} className="panel-inset space-y-1.5 border px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium">{cluster.title}</p>
                    <Link href="/report" className="link shrink-0 text-xs">
                      I&apos;m seeing this
                    </Link>
                  </div>
                  <p className="text-xs" style={{ color: "var(--blue)" }}>
                    {unconfirmedMentionsNote(cluster.candidateSignalCount)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="panel-inset border px-3 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              No private candidate pattern is active. The scanner is still watching public sources, but the board will
              stay quiet until something credible appears.
            </p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rise" style={{ animationDelay: "40ms" }}>
          <StatCard
            label="Player-backed issues"
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
            label="Needs confirmation"
            value={pendingMentions}
            note={claimedFixWatchlistCount > 0 ? `${claimedFixWatchlistCount} claimed-fix watch items` : "Needs another source"}
            tone="amber"
          />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="panel space-y-5">
          <SectionHeader
            title={active.length > 0 ? "What might still be broken" : "Nothing backed by evidence yet"}
            description={
              active.length > 0
                ? "Ranked by approved player reports and public sources. One report is useful, but it is still early."
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
                      <span
                        className={statusBadgeClass(
                          playerIssueStatus({
                            directReportCount: cluster.directReportCount,
                            publicSignalCount: cluster.signalCount,
                            candidateSignalCount: cluster.candidateSignalCount,
                            postCurrentPatchEvidenceCount: cluster.postCurrentPatchEvidenceCount,
                            fixStatus: cluster.fix_status,
                          }).tone,
                        )}
                      >
                        {
                          playerIssueStatus({
                            directReportCount: cluster.directReportCount,
                            publicSignalCount: cluster.signalCount,
                            candidateSignalCount: cluster.candidateSignalCount,
                            postCurrentPatchEvidenceCount: cluster.postCurrentPatchEvidenceCount,
                            fixStatus: cluster.fix_status,
                          }).label
                        }
                      </span>
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

      <section className="panel-inset flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-sm">
        <div style={{ color: "var(--text-dim)" }}>
          <span className={d.scanner.paused ? "badge badge-amber badge-dot" : "badge badge-green badge-dot"}>
            {d.scanner.paused ? "scanner paused" : "scanner scheduled"}
          </span>{" "}
          {d.latestAutomationRun
            ? `Scanner trust context: last scan ${timeAgo(d.latestAutomationRun.finished_at)} · ${latestScanWorkSummary(d.latestAutomationRun)}`
            : "Scanner trust context: no non-test scan has run yet."}
        </div>
        <Link href="/scanner" className="btn btn-ghost btn-sm">
          Source Radar
        </Link>
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
            <span className="badge badge-dim">current patch</span>
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
            <h2 className="h-section">Official context, not proof</h2>
            <a href={d.currentPatch.officialUrl} target="_blank" rel="noreferrer noopener" className="link text-xs">
              Official notes ↗
            </a>
          </div>
          <p className="text-sm font-medium">{d.currentPatch.title}</p>
          <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {d.currentPatch.summary ??
              "Official notes provide the patch label and source context. They do not count as player evidence."}
          </p>
          {patchWatchItems.length > 0 ? (
            <div className="space-y-2 border-t pt-3">
              <div className="stat-label">Official claims and watch status</div>
              {patchWatchItems.slice(0, 3).map((item, index) => (
                <div key={`${item.fixText}-${index}`} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusBadgeClass(item.status.tone)}>{item.status.label}</span>
                    <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                      {item.cluster ? item.cluster.title : "Not matched to a local issue yet"}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                    {item.fixText}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
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
