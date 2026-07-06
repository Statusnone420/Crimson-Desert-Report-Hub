import Link from "next/link";
import { ConfidenceBadge, FixStatusBadge, SectionHeader, SignalConfidenceBadge } from "@/components/ui";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { getIssuesData } from "@/lib/queries";

export const revalidate = 300;

export default async function IssuesPage() {
  const [{ clusters, excerptsByCluster, signalsByCluster }, currentPatch] = await Promise.all([
    getIssuesData(),
    getCurrentPatchMetadata(),
  ]);
  const active = clusters.filter((c) => c.strengthScore > 0);
  const watchlist = clusters.filter((c) => c.strengthScore === 0);
  const persistent = clusters.filter((c) => c.fix_status === "persists").length;

  function ClusterCard({ cluster }: { cluster: (typeof clusters)[number] }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    const excerpts = excerptsByCluster[cluster.id] ?? [];
    const empty = cluster.strengthScore === 0;
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
            <FixStatusBadge status={cluster.fix_status} />
            <ConfidenceBadge confidence={cluster.confidence} />
          </div>
        </div>

        <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          {cluster.description}
        </p>

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

        {empty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Awaiting first reports. Seeing this on {currentPatch.version}?
            </p>
            <Link href="/report" className="btn btn-ghost btn-sm">
              Report this
            </Link>
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
        description="Grouped from approved player reports and public community signals. Public quotes are neutral generated summaries or admin-approved excerpts. Raw submissions are never published."
      />

      <section className="grid grid-cols-3 gap-3">
        <div className="panel">
          <div className="stat-label">Tracked</div>
          <div className="stat-value mt-1.5">{clusters.length}</div>
        </div>
        <div className="panel">
          <div className="stat-label">With evidence</div>
          <div className="stat-value mt-1.5">{active.length}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Persistent</div>
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

          {watchlist.length > 0 ? (
            <section className="space-y-3">
              <div className="stat-label">Watchlist · awaiting first reports</div>
              {watchlist.map((cluster) => (
                <ClusterCard key={cluster.id} cluster={cluster} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
