import Link from "next/link";
import { Sparkline } from "@/components/Sparkline";
import { FixStatusBadge, MeterBar, StatCard } from "@/components/ui";
import { CATEGORY_LABELS, CURRENT_PATCH, PLATFORM_LABELS } from "@/lib/constants";
import { getDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

function timeAgo(iso: string | null): string {
  if (!iso) return "no reports yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function automationWorkSummary(run: NonNullable<Awaited<ReturnType<typeof getDashboardData>>["latestAutomationRun"]>): string {
  return `${run.search_queries_used} web searches · ${run.llm_calls_used} AI extractions · ${run.signals_inserted} signals`;
}

export default async function DashboardPage() {
  const d = await getDashboardData();
  const maxCluster = Math.max(...d.topClusters.map((cluster) => cluster.strengthScore), 1);
  const platformEntries = Object.entries(d.platforms).sort((a, b) => b[1] - a[1]);
  const categoryEntries = Object.entries(d.byCategory).sort((a, b) => b[1] - a[1]);
  const persistentCount = d.topClusters.filter((cluster) => cluster.fix_status === "persists").length;

  return (
    <div className="space-y-7">
      <section className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <p className="stat-label">Unofficial community evidence tracker</p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
            Crimson Desert report hub
          </h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            Automated community signals plus direct patch {CURRENT_PATCH} reports, clustered into evidence Pearl Abyss can
            act on. Raw submissions stay private until reviewed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:justify-end">
          <span className="badge badge-crimson">Patch {CURRENT_PATCH}</span>
          <Link href="/report" className="btn">
            Submit report
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Community signals" value={d.communitySignals} note="Public automation only" tone="crimson" />
        <StatCard label="Direct reports" value={d.directReports} note={`+${d.weekDelta} this week`} tone="green" />
        <StatCard label="Verified reports" value={d.verifiedReports} note="Reports with excerpts" tone="amber" />
        <StatCard
          label="Awaiting review"
          value={d.pendingCount}
          note={`${persistentCount} persistent fix flags`}
          tone="dim"
        />
      </section>

      <section className="panel flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="stat-label">Scanner status</div>
          <h2 className="text-lg font-semibold">
            AI scanner {d.scanner.paused ? "paused by the maintainer" : "watching public sources"}
          </h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            The scanner checks public web results and optional public Reddit posts, then uses a free OpenRouter model to
            extract issue title, category, platform, and evidence URL. It does not post to Reddit or X, and raw player
            submissions stay private until reviewed.
          </p>
        </div>
        <div className="min-w-56 text-sm">
          <span className={d.scanner.paused ? "badge badge-amber" : "badge badge-green"}>
            {d.scanner.paused ? "scheduled scans off" : "scheduled scans on"}
          </span>
          <p className="mt-3" style={{ color: "var(--text-dim)" }}>
            {d.latestAutomationRun
              ? `Last scan: ${timeAgo(d.latestAutomationRun.started_at)} · ${d.latestAutomationRun.status}`
              : "No scanner run yet."}
          </p>
          {d.latestAutomationRun ? (
            <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
              {automationWorkSummary(d.latestAutomationRun)}
            </p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.45fr_0.9fr]">
        <div className="panel space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Top issues this patch</h2>
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                Ranked by public community signals and approved direct reports. Last report: {timeAgo(d.latestReportAt)}.
              </p>
            </div>
            <Link href="/issues" className="btn btn-ghost">
              Review clusters
            </Link>
          </div>

          {d.topClusters.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              No issue clusters yet. Seed taxonomy will appear here after migration data is available.
            </p>
          ) : (
            <div className="space-y-4">
              {d.topClusters.slice(0, 8).map((cluster) => (
                <div key={cluster.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{cluster.title}</span>
                      <FixStatusBadge status={cluster.fix_status} />
                    </span>
                    <span className="ml-auto shrink-0" style={{ color: "var(--text-dim)" }}>
                      {cluster.signalCount} signals · {cluster.directReportCount} reports
                    </span>
                  </div>
                  <MeterBar
                    value={cluster.strengthScore}
                    max={maxCluster}
                    color={cluster.fix_status === "persists" ? "var(--amber)" : "var(--crimson)"}
                  />
                </div>
              ))}
            </div>
          )}

          <p className="border-t pt-3 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>
            Seeded issue clusters are tagged unverified and start at zero. Hidden seed clusters never enter public top issues
            until public signals or direct reports confirm them.
          </p>
        </div>

        <div className="panel space-y-5">
          <div>
            <div className="stat-label mb-2">Platforms</div>
            {platformEntries.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                No approved reports yet.
              </p>
            ) : (
              <div className="space-y-1">
                {platformEntries.map(([platform, count]) => (
                  <div
                    key={platform}
                    className="flex items-center justify-between border-b py-2 text-sm last:border-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="stat-label mb-2">By category</div>
            {categoryEntries.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                Counts appear after moderation.
              </p>
            ) : (
              <div className="space-y-1">
                {categoryEntries.map(([category, count]) => (
                  <div key={category} className="flex items-center justify-between py-1 text-sm">
                    <span style={{ color: "var(--text-dim)" }}>
                      {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}
                    </span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="stat-label">Reports over time</div>
            <h2 className="text-lg font-semibold">30-day activity</h2>
          </div>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            Moderated reports only
          </span>
        </div>
        <Sparkline points={d.series.map((point) => point.count)} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="panel">
          <div className="stat-label">Privacy</div>
          <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
            No accounts, ads, analytics trackers, or raw IP storage. Moderators approve excerpts before public display.
          </p>
        </div>
        <div className="panel">
          <div className="stat-label">Evidence</div>
          <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
            Reports capture platform, severity, frequency, hardware, repro notes, and optional evidence links.
          </p>
        </div>
        <div className="panel">
          <div className="stat-label">Official channel</div>
          <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>
            Crash logs and PERS IDs still belong in Pearl Abyss support. This hub organizes community signals.
          </p>
        </div>
      </section>
    </div>
  );
}
