import Link from "next/link";
import { EvidenceLadderBadge, FixStatusBadge, SectionHeader, SignalConfidenceBadge } from "@/components/ui";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { countEvidenceBackedPersistentClusters, hasClusterEvidence, isUnverifiedWatchlistCluster } from "@/lib/evidence";
import { clusterEvidenceState } from "@/lib/evidenceLadder";
import { getIssuesData, getLatestPublicScanMeta } from "@/lib/queries";

export const revalidate = 300;

function timeAgo(iso: string | null): string {
  if (!iso) return "no runs yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function IssuesPage() {
  const [{ clusters, excerptsByCluster, signalsByCluster }, scanMeta] = await Promise.all([
    getIssuesData(),
    getLatestPublicScanMeta(),
  ]);
  const active = clusters.filter(hasClusterEvidence);
  const watchlist = clusters.filter((c) => !hasClusterEvidence(c));
  const candidates = watchlist.filter((c) => c.candidateSignalCount > 0);
  const monitored = watchlist.filter((c) => c.candidateSignalCount === 0);
  const persistent = countEvidenceBackedPersistentClusters(clusters);

  function ClusterCard({ cluster }: { cluster: (typeof clusters)[number] }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    const excerpts = excerptsByCluster[cluster.id] ?? [];
    const unverified = isUnverifiedWatchlistCluster(cluster);
    const state = clusterEvidenceState({
      directReportCount: cluster.directReportCount,
      publicSignalCount: cluster.signalCount,
      candidateSignalCount: cluster.candidateSignalCount,
    });
    return (
      <article className="panel space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-lg font-semibold">{cluster.title}</h2>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}
              {" · "}
              <span className="num">{cluster.directReportCount}</span> reports
              {" · "}
              <span className="num">{cluster.signalCount}</span> signals
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FixStatusBadge status={cluster.fix_status} unverified={unverified} />
            <EvidenceLadderBadge state={state} />
          </div>
        </div>

        <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          {cluster.description}
        </p>

        {state === "candidates" ? (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            {cluster.candidateSignalCount} unconfirmed {cluster.candidateSignalCount === 1 ? "mention" : "mentions"} —
            not enough separate sources to back it yet
          </p>
        ) : null}

        {signals.length > 0 ? (
          <div className="space-y-3 border-t pt-3">
            <div className="stat-label">Community signals</div>
            {signals.slice(0, 3).map((signal) => (
              <div key={signal.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <SignalConfidenceBadge confidence={signal.confidence} />
                  <span className="badge badge-dim">{signal.source.replace("_", " ")}</span>
                </div>
                <p className="leading-6" style={{ color: "var(--text-dim)" }}>
                  {signal.summary}
                </p>
                <a href={signal.source_url} target="_blank" rel="noreferrer noopener" className="link text-xs">
                  View source ↗
                </a>
              </div>
            ))}
          </div>
        ) : null}

        {excerpts.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <div className="stat-label">Approved excerpts</div>
            {excerpts.slice(0, 3).map((excerpt, index) => (
              <blockquote key={`${cluster.id}-${index}`} className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                &ldquo;{excerpt.text}&rdquo; &mdash;{" "}
                {PLATFORM_LABELS[excerpt.platform as keyof typeof PLATFORM_LABELS] ?? excerpt.platform} player
              </blockquote>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Moderated public evidence"
        title="Issue clusters"
        description="Evidence counts come from approved player reports, public signals backed by separate sources, and admin-approved excerpts. Seeded watchlist items stay unverified until the data confirms them."
      />

      <section className="grid grid-cols-3 gap-3">
        <div className="panel">
          <div className="stat-label">Watchlist items</div>
          <div className="stat-value mt-1.5">{clusters.length}</div>
        </div>
        <div className="panel">
          <div className="stat-label">With evidence</div>
          <div className="stat-value mt-1.5">{active.length}</div>
          {active.length === 0 ? (
            <div className="mt-1.5 text-xs font-medium" style={{ color: "var(--text-dim)" }}>
              nothing confirmed yet
            </div>
          ) : null}
        </div>
        <div className="panel">
          <div className="stat-label">Evidence-backed persistent</div>
          <div className="stat-value mt-1.5" style={{ color: active.length ? "var(--crimson-bright)" : undefined }}>
            {persistent}
          </div>
        </div>
      </section>

      {clusters.length === 0 ? (
        <div className="panel text-sm" style={{ color: "var(--text-dim)" }}>
          No public issue clusters yet.
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <section className="space-y-3">
              {active.map((cluster) => (
                <ClusterCard key={cluster.id} cluster={cluster} />
              ))}
            </section>
          ) : null}

          {candidates.length > 0 || monitored.length > 0 ? (
            <section className="panel space-y-3">
              <div className="space-y-1">
                <h2 className="stat-label">Watchlist</h2>
                <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  Nothing here is backed yet. A topic moves up the moment a player report or public source backs it.
                </p>
              </div>
              {candidates.length > 0 ? (
                <div className={candidates.length === 1 ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
                  {candidates.map((cluster) => (
                    <div key={cluster.id} className="panel-inset space-y-1.5 border px-3 py-2.5">
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
                        {cluster.candidateSignalCount} unconfirmed{" "}
                        {cluster.candidateSignalCount === 1 ? "mention" : "mentions"} — not enough separate sources to
                        back it yet
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {monitored.length > 0 ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--text-faint)" }}
                  title="The scanner checks public sources each run."
                >
                  Monitoring {monitored.length} more known problem {monitored.length === 1 ? "area" : "areas"} — no
                  player reports or public sources yet.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  The scanner checks public sources every run. Last run finished {timeAgo(scanMeta?.finishedAt ?? null)}.
                </p>
                <Link href="/report" className="btn btn-ghost btn-sm">
                  Seeing a bug? Report it
                </Link>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
