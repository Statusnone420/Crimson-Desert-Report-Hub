import Link from "next/link";
import { Sparkline } from "@/components/Sparkline";
import { EvidenceLadderBadge, FixStatusBadge, MeterBar, SectionHeader, StatCard } from "@/components/ui";
import { routeToWatchlistCluster } from "@/lib/automation/route";
import { CATEGORY_LABELS, PLATFORM_LABELS, type Category } from "@/lib/constants";
import {
  countEvidenceBackedPersistentClusters,
  countUnverifiedClaimedFixWatchlistClusters,
  hasClusterEvidence,
} from "@/lib/evidence";
import { clusterEvidenceState } from "@/lib/evidenceLadder";
import { getDashboardData } from "@/lib/queries";

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

function isContradictedByEvidence(
  fix: { fixText: string; category: string | null },
  clusters: { id: string; slug: string; title: string; category: string; strengthScore: number }[],
): boolean {
  if (!fix.category) return false;
  const matched = routeToWatchlistCluster(
    {
      issueTitle: fix.fixText,
      summary: fix.fixText,
      category: fix.category as Category,
      llmClusterSlug: null,
    },
    clusters,
  );
  if (!matched) return false;
  const cluster = clusters.find((candidate) => candidate.id === matched.id);
  return (cluster?.strengthScore ?? 0) > 0;
}

export default async function DashboardPage() {
  const d = await getDashboardData();
  const persistentCount = countEvidenceBackedPersistentClusters(d.topClusters);
  const claimedFixWatchlistCount = countUnverifiedClaimedFixWatchlistClusters(d.topClusters);
  const active = d.topClusters.filter(hasClusterEvidence);
  const watchlist = d.topClusters.filter((c) => !hasClusterEvidence(c));
  const maxStrength = Math.max(...active.map((c) => c.strengthScore), 1);
  const platformEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);
  const gpuEntries = Object.entries(d.gpus).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const categoryEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const maxPlatform = Math.max(...platformEntries.map(([, n]) => n), 1);
  const patchLabel = `Patch ${d.currentPatch.version}`;
  const totalCandidates = d.topClusters.reduce((sum, cluster) => sum + cluster.candidateSignalCount, 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rise grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2.5">
          <h1 className="h-display max-w-3xl">Crimson Desert Report Hub</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            An unofficial community evidence tracker: approved player reports and public signals backed by separate
            sources become evidence; seeded watchlist items stay clearly unverified until the data confirms them. Raw
            submissions stay private.
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs" style={{ color: "var(--text-faint)" }}>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.topClusters.length}</span> watchlist items
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.directReports}</span> reports
            <span aria-hidden="true">·</span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{d.communitySignals}</span> public signals
            <span aria-hidden="true">·</span>
            updated {timeAgo(d.latestReportAt)}
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

      {/* Headline stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rise" style={{ animationDelay: "40ms" }}>
          <StatCard
            label="Total reports"
            value={d.directReports}
            note={d.directReports === 0 ? "be the first — takes 60 seconds" : `+${d.weekDelta} this week`}
            tone="crimson"
          />
        </div>
        <div className="rise" style={{ animationDelay: "80ms" }}>
          <StatCard
            label="Community signals"
            value={d.communitySignals}
            note={
              d.communitySignals === 0
                ? totalCandidates > 0
                  ? `${totalCandidates} unconfirmed mention(s)`
                  : "none found yet — scanner active"
                : "Public · sourced"
            }
            tone="blue"
          />
        </div>
        <div className="rise" style={{ animationDelay: "120ms" }}>
          <StatCard
            label="Watchlist items"
            value={d.topClusters.length}
            note={active.length === 0 ? "Awaiting evidence" : `${active.length} with evidence`}
            tone="dim"
          />
        </div>
        <div className="rise" style={{ animationDelay: "160ms" }}>
          <StatCard
            label="Evidence-backed persistence"
            value={persistentCount}
            note={claimedFixWatchlistCount > 0 ? `${claimedFixWatchlistCount} claimed-fix watchlist` : "Only counts vetted evidence"}
            tone="amber"
          />
        </div>
      </section>

      {/* Official patch-note claimed fixes */}
      {d.claimedFixes.length > 0 ? (
        <section className="panel space-y-3">
          <div className="stat-label">What patch {d.currentPatch.version} claims to fix</div>
          <div className="space-y-2">
            {d.claimedFixes.map((fix, index) => {
              const contradicted = isContradictedByEvidence(fix, d.topClusters);
              return (
                <div key={index} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1" style={{ color: "var(--text-dim)" }}>
                    {fix.fixText}
                  </span>
                  <span className={contradicted ? "badge badge-crimson shrink-0" : "badge badge-dim shrink-0"}>
                    {contradicted ? "still reported broken" : "no reports against it"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="border-t pt-3 text-xs" style={{ color: "var(--text-faint)" }}>
            Sourced from Pearl Abyss&apos;s official patch notes. &quot;No reports against it&quot; means no player
            reports or public sources dispute this fix yet.
          </p>
        </section>
      ) : null}

      {/* Top issues + platforms */}
      <section className="grid gap-3 lg:grid-cols-[1.5fr_0.9fr]">
        <div className="panel space-y-5">
          <SectionHeader
            title={active.length > 0 ? "Top issues this patch" : "Watchlist awaiting evidence"}
            description={
              active.length > 0
                ? "Ranked by approved reports and public signals."
                : "These are seeded watchlist items. They do not become evidence until approved reports or public signals confirm them."
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

          {watchlist.length > 0 ? (
            <div className="space-y-2.5">
              {active.length > 0 ? <div className="stat-label pt-1">Watchlist · awaiting first reports</div> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {watchlist.map((cluster) => (
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
                  </Link>
                ))}
              </div>
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

      {/* Scanner + official source */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="panel space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="h-section">Automated scanner</h2>
            <span className={d.scanner.paused ? "badge badge-amber badge-dot" : "badge badge-green badge-dot"}>
              {d.scanner.paused ? "paused" : "scheduled on"}
            </span>
          </div>
          <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Scheduled scans check public web search and optional Reddit sources about {d.currentPatch.version}. Nothing
            goes public until a find is backed up by separate sources or a player report.
          </p>
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {d.latestAutomationRun
              ? `Last scan finished ${timeAgo(d.latestAutomationRun.finished_at)} · ${d.latestAutomationRun.status} · ${d.latestAutomationRun.search_results_seen} sources reviewed · ${d.latestAutomationRun.signals_inserted} mentions kept${d.latestAutomationRun.search_queries_used === 0 ? " · search skipped this run" : ""}`
              : "No non-test scan has run yet."}
          </p>
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
              "The hub reads Pearl Abyss announcements so the patch label and scanner stay aligned with the official update stream."}
          </p>
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {d.currentPatch.publishedAt
              ? `Published ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(d.currentPatch.publishedAt))}`
              : "Publish time not stored yet."}
          </p>
        </div>
      </section>

      {/* Activity */}
      <section className="panel">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="h-section">30-day activity</h2>
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            Approved reports only
          </span>
        </div>
        {d.series.some((point) => point.count > 0) ? (
          <Sparkline points={d.series.map((point) => point.count)} />
        ) : (
          <div className="flex h-16 items-center justify-center text-xs" style={{ color: "var(--text-faint)" }}>
            The activity line starts drawing once approved reports come in.
          </div>
        )}
      </section>

      {/* Trust notes — quieter than the data panels above */}
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
