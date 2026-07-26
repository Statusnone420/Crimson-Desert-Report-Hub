import type { ResolvingMetadata } from "next";
import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { PublicShell } from "@/components/dispatch/Chrome";
import { categoryChartColor } from "@/lib/categoryColors";
import { CATEGORY_LABELS, PLATFORM_LABELS, PLATFORMS } from "@/lib/constants";
import { DISPLAY_THRESHOLD_NETWORKS } from "@/lib/readout";
import { displayDescription, hasClusterEvidence, monitoredAreasNote, needsFullIssueCard, splitWatchlistByCandidates } from "@/lib/evidence";
import { patchFamilyKey } from "@/lib/patchWatch";
import { getIssuesData, getLatestPublicScanMeta } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata("Issue Board", "/issues", parent);
}

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
  // Watched is the whole public set: published entries plus the watchlist
  // remainder, and the two always sum to it. It has never been patch-scoped
  // though the page kicker names a patch, so the caption says so wherever the
  // number is read — desktop band and mobile statline alike.
  const watchedCaption = `${active.length} published + ${watchlist.length} on the watchlist · every patch, not just ${currentPatch.version}`;

  // Entry treatment by evidence weight: the first full entry leads at the
  // largest scale; entries with an active claim poll get the claim-verdict
  // rail; everything else runs two-up as minor entries.
  const [leadEntry, ...restEntries] = active;
  const contestedEntries = restEntries.filter((cluster) => cluster.readout.poll !== null);
  const minorEntries = restEntries.filter((cluster) => cluster.readout.poll === null);
  const radarEntries = candidates;
  // The watchlist splits into the entries this section renders and a monitored
  // remainder, so each half states its own share of the total rather than
  // leaving the reader to subtract one number from another.
  const watchlistShownNote = `Showing ${radarEntries.length} of ${watchlist.length} watchlist issue${
    watchlist.length === 1 ? "" : "s"
  }`;

  function statusLine({ cluster }: { cluster: (typeof clusters)[number] }) {
    const tone = cluster.readout.tone;
    const category = (
      CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category
    ).toUpperCase();
    const metaParts = [`${cluster.directReportCount} REPORT${cluster.directReportCount === 1 ? "" : "S"}`];
    if (cluster.signalCount > 0) {
      metaParts.push(`${cluster.signalCount} SOURCE LINK${cluster.signalCount === 1 ? "" : "S"}`);
    }
    metaParts.push(`${cluster.confirmations.totalCount} TAP${cluster.confirmations.totalCount === 1 ? "" : "S"}`);
    return (
      <div className={`status-line status-line--${tone}`}>
        <span className="status-line__dot" aria-hidden="true" />
        <span className={`status-line__label--${tone}`}>{cluster.readout.label.toUpperCase()}</span>
        <span className="status-line__meta">
          ·{" "}
          <i
            className="cat-swatch cat-swatch--meta"
            style={{ background: categoryChartColor(cluster.category) }}
            aria-hidden="true"
          />
          {category} · {metaParts.join(" · ")}
        </span>
      </div>
    );
  }

  function platformTallies({ cluster }: { cluster: (typeof clusters)[number] }) {
    const rows = PLATFORMS.map((platform) => {
      const reports = cluster.reportPlatformCounts[platform] ?? 0;
      const confirms = cluster.confirmations.byPlatform[platform] ?? { count: 0, networks: 0 };
      const escalatedConfirms = confirms.networks >= DISPLAY_THRESHOLD_NETWORKS ? confirms.count : 0;
      return { platform, reports, confirms: confirms.count, weight: reports * 3 + escalatedConfirms };
    }).filter((row) => row.reports > 0 || row.confirms > 0);
    if (rows.length === 0) return null;
    const max = Math.max(...rows.map((row) => row.weight), 1);
    return (
      <div className="platform-meters platform-meters--bounded">
        {rows.map((row) => (
          <div key={row.platform} className="platform-meter platform-meter--wide">
            <span>{PLATFORM_LABELS[row.platform as keyof typeof PLATFORM_LABELS] ?? row.platform}</span>
            <div className="platform-meter__track">
              <div
                className="platform-meter__fill"
                style={{ width: `${Math.max(8, Math.round((row.weight / max) * 100))}%` }}
              />
            </div>
            <span className="platform-meter__count">
              {row.reports} rpt · {row.confirms} tap
            </span>
          </div>
        ))}
      </div>
    );
  }

  function confirmStrip({ cluster }: { cluster: (typeof clusters)[number] }) {
    const ask = cluster.readout.ask;
    if (!ask) return null;
    const counts = ask.kinds.includes("have_it")
      ? { have_it: cluster.confirmations.byKind.have_it.count }
      : {
          fixed_for_me: cluster.confirmations.pollFixedCount,
          still_happening: cluster.confirmations.pollStillCount,
        };
    return (
      <ConfirmButtons
        clusterId={cluster.id}
        storageScope={ask.kinds.includes("have_it") ? patchFamily : currentPatch.version}
        question={ask.question}
        kinds={ask.kinds}
        counts={counts}
      />
    );
  }

  function excerpts({ cluster, limit = 3 }: { cluster: (typeof clusters)[number]; limit?: number }) {
    const excerpts = excerptsByCluster[cluster.id] ?? [];
    if (excerpts.length === 0) return null;
    return (
      <>
        {excerpts.slice(0, limit).map((excerpt, index) => (
          <blockquote key={`${cluster.id}-excerpt-${index}`} className="issue-excerpt">
            &ldquo;{excerpt.text}&rdquo;{" "}
            <cite>
              — {(PLATFORM_LABELS[excerpt.platform as keyof typeof PLATFORM_LABELS] ?? excerpt.platform).toUpperCase()}{" "}
              PLAYER
            </cite>
          </blockquote>
        ))}
      </>
    );
  }

  function signalRailItems({ cluster }: { cluster: (typeof clusters)[number] }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    return (
      <>
        {signals.slice(0, 3).map((signal) => (
          <div key={signal.id} className="issue-rail__item">
            <span className="issue-rail__domain">{sourceHost(signal.source_url, signal.source)}</span>
            <span className="issue-rail__title">{signal.summary}</span>
            <span className="issue-rail__link">
              <a className="dispatch-link" href={signal.source_url} target="_blank" rel="noreferrer noopener">
                Open source
              </a>
            </span>
          </div>
        ))}
      </>
    );
  }

  function linksRail({ cluster }: { cluster: (typeof clusters)[number] }) {
    const signals = signalsByCluster[cluster.id] ?? [];
    const shownSignals = Math.min(signals.length, 3);
    const railLabel = `Link${shownSignals === 1 ? "" : "s"} seen in the wild`;
    return (
      <div className="issue-rail">
        {signals.length > 0 ? (
          <>
            <div className="dispatch-desktop-only">
              <div className="issue-rail__label">{railLabel}</div>
              {signalRailItems({ cluster })}
            </div>
            <details className="issue-rail__details dispatch-mobile-only">
              <summary>
                {railLabel} · {shownSignals} ▾
              </summary>
              {signalRailItems({ cluster })}
            </details>
          </>
        ) : null}
        <p className="issue-rail__caption">
          Links are leads, never evidence —{" "}
          <Link href="/about#source" className="dispatch-link">
            see when a link goes public
          </Link>
          .
        </p>
      </div>
    );
  }

  function verdictRail({ cluster }: { cluster: (typeof clusters)[number] }) {
    const poll = cluster.readout.poll;
    if (!poll) return null;
    const total = poll.fixedCount + poll.stillCount;
    const fixedPct = total > 0 ? Math.round((poll.fixedCount / total) * 100) : 0;
    return (
      <div className="issue-rail issue-rail--center">
        <div className="issue-rail__label" style={{ paddingBottom: 0 }}>
          Claim verdict · taps after the fix claim
        </div>
        {total > 0 ? (
          <>
            <div className="verdict-bar" role="presentation">
              <div className="verdict-bar__fixed" style={{ width: `${fixedPct}%` }} />
              <div className="verdict-bar__still" style={{ width: `${100 - fixedPct}%` }} />
            </div>
            <div className="verdict-labels">
              <span className="verdict-labels__fixed">{poll.fixedCount} fixed for me</span>
              <span className="verdict-labels__still">{poll.stillCount} still happening</span>
            </div>
          </>
        ) : (
          <div className="verdict-quiet">No player verdicts yet</div>
        )}
        {confirmStrip({ cluster })}
      </div>
    );
  }

  const boardBody =
    clusters.length === 0 ? (
      <div className="issues-empty">
        <p>
          No published issues yet for {currentPatch.version}. Publishing needs a player report or corroborated
          sources —{" "}
          <Link href="/about" className="dispatch-link">
            read the method
          </Link>
          . Leads stay private until they are corroborated.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/report" className="dispatch-btn">
            File a report
          </Link>
          <Link href="/scanner" className="dispatch-link" style={{ fontSize: 13.5 }}>
            Scanner funnel →
          </Link>
        </div>
      </div>
    ) : (
      <>
        {leadEntry ? (
          <article className="issue-entry-row issue-entry-row--lead" aria-label={leadEntry.title}>
            <div className="issue-entry-row__main">
              <p className="issue-tier-label">The lead issue</p>
              {statusLine({ cluster: leadEntry })}
              <h2 className="issue-title issue-title--lead">{leadEntry.title}</h2>
              <blockquote
                className={
                  leadEntry.readout.tone === "amber" ? "issue-quoteline issue-quoteline--amber" : "issue-quoteline"
                }
              >
                {leadEntry.readout.sentence}
              </blockquote>
              {displayDescription(leadEntry.title, leadEntry.description) ? (
                <p className="issue-summary">{displayDescription(leadEntry.title, leadEntry.description)}</p>
              ) : null}
              {excerpts({ cluster: leadEntry })}
              {platformTallies({ cluster: leadEntry })}
              {leadEntry.readout.poll === null ? confirmStrip({ cluster: leadEntry }) : null}
            </div>
            {leadEntry.readout.poll !== null ? verdictRail({ cluster: leadEntry }) : linksRail({ cluster: leadEntry })}
          </article>
        ) : null}

        {contestedEntries.map((cluster) => (
          <article key={cluster.id} className="issue-entry-row" aria-label={cluster.title}>
            <div className="issue-entry-row__main">
              {statusLine({ cluster })}
              <h2 className="issue-title issue-title--row">{cluster.title}</h2>
              <blockquote
                className={
                  cluster.readout.tone === "amber" || cluster.readout.tone === "crimson"
                    ? "issue-quoteline issue-quoteline--amber"
                    : "issue-quoteline"
                }
              >
                {cluster.readout.sentence}
              </blockquote>
              {displayDescription(cluster.title, cluster.description) ? (
                <p className="issue-summary">{displayDescription(cluster.title, cluster.description)}</p>
              ) : null}
              {excerpts({ cluster, limit: 2 })}
            </div>
            {verdictRail({ cluster })}
          </article>
        ))}

        {minorEntries.length > 0 ? (
          <>
            <p className="issue-group-label">
              Also reported
              <span className="issue-group-label__note">player evidence · lower volume</span>
            </p>
            <div className="issue-minors">
            {minorEntries.map((cluster) => (
              <article key={cluster.id} className="issue-minor" aria-label={cluster.title}>
                {statusLine({ cluster })}
                <h2 className="issue-title issue-title--minor">{cluster.title}</h2>
                {displayDescription(cluster.title, cluster.description) ? (
                  <p className="issue-minor__summary">{displayDescription(cluster.title, cluster.description)}</p>
                ) : null}
                {excerpts({ cluster, limit: 1 })}
                {confirmStrip({ cluster })}
              </article>
            ))}
            </div>
          </>
        ) : null}

        {radarEntries.length > 0 ? (
          <>
            <p className="issue-group-label">
              Radar leads
              <span className="issue-group-label__note">
                {watchlistShownNote} · source signals · not player evidence
              </span>
            </p>
            <div className="issue-minors">
            {radarEntries.map((cluster) => (
              <article key={cluster.id} className="issue-minor" aria-label={cluster.title}>
                <div className="status-line status-line--blue">
                  <span className="status-line__dot" aria-hidden="true" />
                  <span className="status-line__label--blue">RADAR LEAD</span>
                  <span className="status-line__meta">
                    ·{" "}
                    <i
                      className="cat-swatch cat-swatch--meta"
                      style={{ background: categoryChartColor(cluster.category) }}
                      aria-hidden="true"
                    />
                    {(
                      CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category
                    ).toUpperCase()}
                  </span>
                </div>
                <h2 className="issue-title issue-title--minor">{cluster.title}</h2>
                <p className="issue-minor__summary">{cluster.readout.sentence}</p>
                {confirmStrip({ cluster })}
              </article>
            ))}
            </div>
          </>
        ) : null}

        <div className="issue-watch-note">
          {monitored.length > 0 ? (
            <p title="The scanner checks public sources each run.">{monitoredAreasNote(monitored.length)}</p>
          ) : null}
          <p>
            The scanner checks public sources every run. Last run finished {timeAgo(scanMeta?.finishedAt ?? null)}.{" "}
            <Link href="/report" className="dispatch-link">
              Seeing a bug? Report it ↗
            </Link>
          </p>
        </div>
      </>
    );

  return (
    <PublicShell active="issues">
      <div className="dispatch-container">
        <header className="dispatch-pagehead">
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker">Issue Board · Patch {currentPatch.version}</p>
            <h1 className="dispatch-pagehead__title">What players are reporting</h1>
            <p className="dispatch-pagehead__dek">
              Every count below is a report or tap someone actually sent — the board never fills in blanks.
              Entries need player evidence, a signal, or a public link; the radar tracks more in
              aggregate on{" "}
              <Link href="/scanner" className="dispatch-link">
                the Observatory
              </Link>
              .
            </p>
            <p className="issues-statline dispatch-mobile-only">
              {clusters.length} watched · {evidenceBacked.length} with reports · {stillHappening} still happening
            </p>
            <p className="issues-statline dispatch-mobile-only">{watchedCaption}</p>
          </div>
          <div className="stat-band stat-band--inline dispatch-desktop-only" aria-label="Issue board summary">
            <div className="stat-band__cell">
              <div className="stat-band__label">Watched</div>
              <div className="stat-band__value">{clusters.length}</div>
              <div className="stat-band__caption">{watchedCaption}</div>
            </div>
            <div className="stat-band__cell">
              <div className="stat-band__label">With reports</div>
              <div className="stat-band__value">{evidenceBacked.length}</div>
            </div>
            <div className="stat-band__cell">
              <div className="stat-band__label">Still happening</div>
              <div className={stillHappening > 0 ? "stat-band__value stat-band__value--crimson" : "stat-band__value"}>
                {stillHappening}
              </div>
            </div>
          </div>
        </header>
        {boardBody}
      </div>
    </PublicShell>
  );
}
