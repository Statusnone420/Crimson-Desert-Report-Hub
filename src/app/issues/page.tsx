import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { MeterBar, ReadoutBadge, SectionHeader, StatCard } from "@/components/ui";
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
      <div className="space-y-1.5 border-t pt-3">
        {rows.map((row) => (
          <div key={row.platform} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 text-xs">
            <span style={{ color: "var(--text-dim)" }}>
              {PLATFORM_LABELS[row.platform as keyof typeof PLATFORM_LABELS] ?? row.platform}
            </span>
            <MeterBar value={row.weight} max={max} tone={row.weight > 0 ? cluster.readout.tone : "dim"} />
            <span className="num" style={{ color: "var(--text-faint)" }}>
              {row.reports} {row.reports === 1 ? "report" : "reports"} · {row.confirms} confirm
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
    const fixedPct = Math.round((poll.fixedCount / total) * 100);
    return (
      <div className="space-y-1.5 border-t pt-3">
        {poll.escalated ? (
          <div className="meter" style={{ display: "flex" }} role="presentation">
            <span style={{ width: `${fixedPct}%`, background: "var(--green)" }} />
            <span style={{ width: `${100 - fixedPct}%`, background: "var(--crimson)" }} />
          </div>
        ) : null}
        <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-faint)" }}>
          <span>
            <span className="num" style={{ color: "var(--green-bright)" }}>{poll.fixedCount}</span> say fixed for me
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
      <div className="border-t pt-3">
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

  function ClusterCard({ cluster }: { cluster: (typeof clusters)[number] }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    const excerpts = excerptsByCluster[cluster.id] ?? [];
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
              <span className="num">{cluster.signalCount}</span> source links
              {" · "}
              <span className="num">{cluster.confirmations.totalCount}</span> taps
            </p>
          </div>
          <ReadoutBadge label={cluster.readout.label} tone={cluster.readout.tone} />
        </div>

        <div className="panel-inset border px-3 py-2 text-xs leading-5" style={{ color: "var(--text-dim)" }}>
          {cluster.readout.sentence}
        </div>

        <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          {cluster.description}
        </p>

        <PlatformTallies cluster={cluster} />
        <PollStrip cluster={cluster} />
        <ConfirmStrip cluster={cluster} />

        {signals.length > 0 ? (
          <div className="space-y-3 border-t pt-3">
            <div className="stat-label">Links seen in the wild</div>
            {signals.slice(0, 3).map((signal) => (
              <div key={signal.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-dim">{sourceHost(signal.source_url, signal.source)}</span>
                </div>
                <p className="leading-6" style={{ color: "var(--text-dim)" }}>
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
        label="Current patch watch"
        title="What players are reporting"
        description="Player-reported issues first. Every player count is a report or confirmation tap someone actually sent — the site never fills in blanks."
      />

      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="Watched" value={clusters.length} />
        <StatCard
          label="With reports"
          value={evidenceBacked.length}
          note={evidenceBacked.length === 0 ? "No player reports this patch" : undefined}
        />
        <StatCard
          label="Still happening"
          value={stillHappening}
          valueTone={stillHappening ? "crimson" : undefined}
        />
      </section>

      {clusters.length === 0 ? (
        <div className="panel space-y-3 text-sm" style={{ color: "var(--text-dim)" }}>
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
              Dashboard
            </Link>
          </div>
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
                  Nothing here has a player report or confirmation tap yet. Mapped source links remain leads, not
                  evidence.
                </p>
              </div>
              {candidates.length > 0 ? (
                <div className={candidates.length === 1 ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
                  {candidates.map((cluster) => (
                    <div key={cluster.id} className="panel-inset space-y-2 border px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 text-sm font-medium">{cluster.title}</p>
                        <ReadoutBadge label={cluster.readout.label} tone={cluster.readout.tone} />
                      </div>
                      <p className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                        {cluster.readout.sentence}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-faint)" }}>
                        <span>{CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category}</span>
                        <Link href="/report" className="link shrink-0">
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
                  className="text-xs"
                  style={{ color: "var(--text-faint)" }}
                  title="The scanner checks public sources each run."
                >
                  {monitoredAreasNote(monitored.length)}
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
