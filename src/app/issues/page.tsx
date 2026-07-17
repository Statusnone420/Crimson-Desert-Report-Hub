import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { ReadoutMark, SectionHeader } from "@/components/ui";
import { CATEGORY_LABELS, PLATFORM_LABELS, PLATFORMS } from "@/lib/constants";
import { DISPLAY_THRESHOLD_NETWORKS } from "@/lib/readout";
import { hasClusterEvidence, monitoredAreasNote, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";
import { patchFamilyKey } from "@/lib/patchWatch";
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

function sourceHost(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

export default async function IssuesPage() {
  const [{ clusters, excerptsByCluster, signalsByCluster, currentPatch }, scanMeta] = await Promise.all([
    getIssuesData(),
    getLatestPublicScanMeta(),
  ]);
  const patchFamily = patchFamilyKey(currentPatch.version) ?? currentPatch.version;
  const evidenceBacked = clusters.filter(hasClusterEvidence);
  const active = clusters.filter(needsFullIssueCard);
  const watchlist = clusters.filter((cluster) => !needsFullIssueCard(cluster));
  const { candidates, monitored } = splitWatchlistByCandidates(watchlist);
  const stillHappening = clusters.filter((cluster) => cluster.readout.state === "still_happening").length;

  function PlatformTallies({ cluster }: { cluster: (typeof clusters)[number] }) {
    const rows = PLATFORMS.map((platform) => {
      const reports = cluster.reportPlatformCounts[platform] ?? 0;
      const confirms = cluster.confirmations.byPlatform[platform] ?? { count: 0, networks: 0 };
      const escalatedConfirms = confirms.networks >= DISPLAY_THRESHOLD_NETWORKS ? confirms.count : 0;
      return { platform, reports, confirms: confirms.count, weight: reports * 3 + escalatedConfirms };
    }).filter((row) => row.reports > 0 || row.confirms > 0);
    if (rows.length === 0) return null;
    const max = Math.max(...rows.map((row) => row.weight), 1);
    return (
      <div className="platform-table">
        {rows.map((row) => (
          <div key={row.platform} className="contents">
            <span className="platform-table__label">
              {PLATFORM_LABELS[row.platform as keyof typeof PLATFORM_LABELS] ?? row.platform}
            </span>
            <span className="platform-table__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(8, Math.round((row.weight / max) * 100))}%` }} />
            </span>
            <span className="platform-table__count">
              <span className="num">{row.reports}</span> {row.reports === 1 ? "report" : "reports"} ·{" "}
              <span className="num">{row.confirms}</span> confirm
            </span>
          </div>
        ))}
      </div>
    );
  }

  function PollStrip({ cluster }: { cluster: (typeof clusters)[number] }) {
    const poll = cluster.readout.poll;
    if (!poll || poll.fixedCount + poll.stillCount === 0) return null;
    const total = poll.fixedCount + poll.stillCount;
    const stillPct = Math.round((poll.stillCount / total) * 100);
    return (
      <div className="mt-4 max-w-[34rem] space-y-1.5">
        {poll.escalated ? (
          // One semantic color only: crimson carries the still-happening share; the
          // fixed share is the quiet remainder of the track, not a green light.
          <div className="meter" role="presentation">
            <span style={{ width: `${stillPct}%`, background: "var(--crimson)" }} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--text-faint)" }}>
          <span>
            <span className="num" style={{ color: "var(--text-dim)" }}>{poll.fixedCount}</span> say fixed for me
          </span>
          <span>
            <span className="num" style={{ color: "var(--crimson-bright)" }}>{poll.stillCount}</span> say still happening
          </span>
        </div>
      </div>
    );
  }

  function ConfirmStrip({ cluster }: { cluster: (typeof clusters)[number] }) {
    const ask = cluster.readout.ask;
    if (!ask) return null;
    const counts = ask.kinds.includes("have_it")
      ? { have_it: cluster.confirmations.byKind.have_it.count }
      : {
          fixed_for_me: cluster.confirmations.pollFixedCount,
          still_happening: cluster.confirmations.pollStillCount,
        };
    return (
      <div className="mt-4">
        <ConfirmButtons
          clusterId={cluster.id}
          storageScope={ask.kinds.includes("have_it") ? patchFamily : currentPatch.version}
          question={ask.question}
          kinds={ask.kinds}
          counts={counts}
        />
      </div>
    );
  }

  function ClusterEntry({ cluster, lead }: { cluster: (typeof clusters)[number]; lead?: boolean }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    const excerpts = excerptsByCluster[cluster.id] ?? [];
    return (
      <article className={lead ? "issue-entry issue-entry--lead" : "issue-entry"}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="issue-entry__title min-w-0">{cluster.title}</h2>
          <ReadoutMark label={cluster.readout.label} tone={cluster.readout.tone} />
        </div>
        <p className="issue-entry__meta">
          <span>{CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}</span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="num">{cluster.directReportCount}</span> reports
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="num">{cluster.signalCount}</span> source links
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="num">{cluster.confirmations.totalCount}</span> taps
          </span>
        </p>

        <blockquote className="evidence-quote">{cluster.readout.sentence}</blockquote>

        <p className="mt-3 max-w-prose text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          {cluster.description}
        </p>

        <PlatformTallies cluster={cluster} />
        <PollStrip cluster={cluster} />
        <ConfirmStrip cluster={cluster} />

        {signals.length > 0 ? (
          <div className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: "var(--ink-rule)" }}>
            <div className="stat-label">Links seen in the wild</div>
            {signals.slice(0, 3).map((signal) => (
              <div key={signal.id} className="space-y-1 text-sm">
                <div
                  className="num text-xs uppercase tracking-wide"
                  style={{ color: "var(--text-faint)" }}
                >
                  {sourceHost(signal.source_url, signal.source)}
                </div>
                <p className="max-w-prose leading-6" style={{ color: "var(--text-dim)" }}>
                  {signal.summary}
                </p>
                <a href={signal.source_url} target="_blank" rel="noreferrer noopener" className="link text-xs">
                  Open source
                </a>
              </div>
            ))}
          </div>
        ) : null}

        {excerpts.length > 0 ? (
          <div className="mt-5 space-y-2 border-t pt-4" style={{ borderColor: "var(--ink-rule)" }}>
            <div className="stat-label">Approved excerpts</div>
            {excerpts.slice(0, 3).map((excerpt, index) => (
              <blockquote key={`${cluster.id}-${index}`} className="evidence-quote" style={{ marginTop: 0 }}>
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
    <div className="page-stack editorial-page issues-page">
      <section className="editorial-page__hero">
        <SectionHeader
          as="h1"
          label="Current patch watch"
          title="What players are reporting"
          description="Player-reported issues first. Every player count is a report or confirmation tap someone actually sent — the site never fills in blanks."
        />
      </section>

      <section className="metric-strip metric-strip--3 issue-metrics" aria-label="Issue board summary">
        <article className="metric-card">
          <div className="eyebrow">Watched</div>
          <div className="metric-card__value num">{clusters.length}</div>
        </article>
        <article className="metric-card">
          <div className="eyebrow">With reports</div>
          <div className="metric-card__value num">{evidenceBacked.length}</div>
          {evidenceBacked.length === 0 ? <p>No player reports this patch</p> : null}
        </article>
        <article className={stillHappening ? "metric-card metric-card--crimson" : "metric-card"}>
          <div className="eyebrow">Still happening</div>
          <div className="metric-card__value num">{stillHappening}</div>
        </article>
      </section>

      {clusters.length === 0 ? (
        <div className="space-y-3 border-t pt-5 text-sm" style={{ borderColor: "var(--ink-rule)", color: "var(--text-dim)" }}>
          <p className="font-medium" style={{ color: "var(--text)" }}>
            No public issue clusters yet.
          </p>
          <p className="leading-6">
            Nothing has cleared the public-board rules yet. Source candidates stay private until they are
            corroborated.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/scanner" className="btn btn-ghost btn-sm">
              Scanner funnel
            </Link>
            <Link href="/report" className="btn btn-sm">
              Submit a report
            </Link>
            <Link href="/" className="btn btn-ghost btn-sm">
              Patch Brief
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="issue-list-section">
            <div className="section-intro">
              <div>
                <div className="eyebrow">{currentPatch.version} issue board</div>
                <h2>Top issues this patch</h2>
              </div>
              <p>Every full entry below has player evidence, a confirmation signal, or a published source lead.</p>
            </div>
            {active.length > 0 ? (
              <div className="issue-board">
                {active.map((cluster, index) => (
                  <ClusterEntry key={cluster.id} cluster={cluster} lead={index === 0} />
                ))}
              </div>
            ) : (
              <div className="issue-empty">
                <p className="font-medium" style={{ color: "var(--text)" }}>No evidence-backed issues yet.</p>
                <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
                  The board is watching known areas, but nothing has cleared the public evidence threshold for a full issue card.
                </p>
              </div>
            )}
          </section>

          {candidates.length > 0 || monitored.length > 0 ? (
            <section className="brief-section">
              <div className="section-intro">
                <div>
                  <div className="eyebrow">Watchlist</div>
                  <h2>Waiting on evidence</h2>
                </div>
                <p>
                  Nothing here has a player report or confirmation tap yet. Mapped source links remain leads, not
                  evidence.
                </p>
              </div>
              {candidates.length > 0 ? (
                <div className="issue-board">
                  {candidates.map((cluster) => (
                    <div key={cluster.id} className="issue-entry">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                        <p className="min-w-0 text-base font-semibold">{cluster.title}</p>
                        <ReadoutMark label={cluster.readout.label} tone={cluster.readout.tone} />
                      </div>
                      <p className="issue-entry__meta">
                        {CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}
                      </p>
                      <p className="mt-2 max-w-prose text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                        {cluster.readout.sentence}
                      </p>
                      <div className="mt-2 text-xs">
                        <Link href="/report" className="link">
                          Full report →
                        </Link>
                      </div>
                      <ConfirmStrip cluster={cluster} />
                    </div>
                  ))}
                </div>
              ) : null}
              {monitored.length > 0 ? (
                <p
                  className="mt-3 text-xs"
                  style={{ color: "var(--text-faint)" }}
                  title="The scanner checks public sources each run."
                >
                  {monitoredAreasNote(monitored.length)}
                </p>
              ) : null}
              <div className="method-note mt-6">
                <div className="eyebrow">Scanner</div>
                <p>
                  The scanner checks public sources every run. Last run finished {timeAgo(scanMeta?.finishedAt ?? null)}.
                </p>
                <div className="method-note__links">
                  <Link href="/report" className="link">Seeing a bug? Report it ↗</Link>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
