import { ConfidenceBadge, FixStatusBadge } from "@/components/ui";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { getIssuesData } from "@/lib/queries";

export const dynamic = "force-dynamic";

function SignalConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  if (confidence === "high") return <span className="badge badge-green">High confidence</span>;
  if (confidence === "medium") return <span className="badge badge-amber">Medium confidence</span>;
  return <span className="badge badge-dim">Low confidence</span>;
}

export default async function IssuesPage() {
  const { clusters, excerptsByCluster, signalsByCluster } = await getIssuesData();

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="stat-label">Moderated public evidence</p>
        <h1 className="text-3xl font-semibold">Issue clusters</h1>
        <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          Grouped from public community signals and reviewed direct reports. Quotes are admin-approved excerpts only. Raw
          submissions are never published.
        </p>
      </section>

      {clusters.length === 0 ? (
        <div className="panel text-sm" style={{ color: "var(--text-dim)" }}>
          No public issue clusters yet. Once the seed migration is applied, unverified clusters appear here with zero
          confirmed reports.
        </div>
      ) : (
        <section className="space-y-3">
          {clusters.map((cluster) => (
            <article key={cluster.id} className="panel space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{cluster.title}</h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
                    {CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category} ·{" "}
                    {cluster.signalCount} community signals · {cluster.directReportCount} approved reports
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FixStatusBadge status={cluster.fix_status} />
                  <ConfidenceBadge confidence={cluster.confidence} />
                </div>
              </div>

              <p className="text-sm leading-6">{cluster.description}</p>

              <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="stat-label">Community signals</div>
                {(signalsByCluster[cluster.id] ?? []).length > 0 ? (
                  <div className="space-y-3">
                    {(signalsByCluster[cluster.id] ?? []).slice(0, 3).map((signal) => (
                      <div key={signal.id} className="space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <SignalConfidenceBadge confidence={signal.confidence} />
                          <span className="badge badge-dim">{signal.source.replace("_", " ")}</span>
                        </div>
                        <p className="leading-6" style={{ color: "var(--text-dim)" }}>
                          {signal.summary}
                        </p>
                        <a
                          href={signal.source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-xs"
                          style={{ color: "var(--blue)" }}
                        >
                          View source
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                    No public community signals yet.
                  </p>
                )}
              </div>

              <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="stat-label">Approved excerpts</div>
                {(excerptsByCluster[cluster.id] ?? []).length > 0 ? (
                  (excerptsByCluster[cluster.id] ?? []).slice(0, 3).map((excerpt, index) => (
                    <blockquote
                      key={`${cluster.id}-${index}`}
                      className="text-sm leading-6"
                      style={{ color: "var(--text-dim)" }}
                    >
                      &quot;{excerpt.text}&quot; ·{" "}
                      {PLATFORM_LABELS[excerpt.platform as keyof typeof PLATFORM_LABELS] ?? excerpt.platform} player
                    </blockquote>
                  ))
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                    No public excerpts approved yet.
                  </p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
