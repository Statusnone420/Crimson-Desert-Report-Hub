import Link from "next/link";
import { ConfirmButtons } from "@/components/ConfirmButtons";
import { PublicShell } from "@/components/dispatch/Chrome";
import { CATEGORY_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { uniqueClaimAttributions } from "@/lib/claims";
import { composeDispatchBrief, formatWeeklyDelta, weeklyDeltaSentence } from "@/lib/dispatchBrief";
import { needsFullIssueCard } from "@/lib/evidence";
import { getTrackedPatchEditionCount } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import {
  getDashboardData,
  getDailySignalRollup,
  getPublicScannerData,
  type DailySignalDay,
} from "@/lib/queries";

export const revalidate = 300;

function timeAgo(iso: string | null): string {
  if (!iso) return "no reports yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

function mediumDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function officialHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "official notes";
  }
}

/**
 * Paired-bar daily chart, server-rendered SVG. Taps behind-left, reports
 * right, shared linear scale. Zero days render no bars; the axis and date
 * labels always render so a quiet board still reads as a chart.
 */
function PulseChart({
  series,
  width,
  height,
  plotHeight,
  maxDays,
  barWidth,
  leftPad,
  labelsInSvg,
}: {
  series: DailySignalDay[];
  width: number;
  height: number;
  plotHeight: number;
  maxDays: number;
  barWidth: number;
  leftPad: number;
  labelsInSvg: boolean;
}) {
  const shown = series.slice(-maxDays);
  const count = Math.max(shown.length, 1);
  const pitch = Math.min(80, Math.floor((width - leftPad * 2) / count));
  const barW = Math.min(barWidth, Math.max(4, Math.floor((pitch - 4) / 2)));
  const maxValue = Math.max(1, ...shown.map((day) => Math.max(day.taps, day.reports)));
  const k = plotHeight / maxValue;
  const scaled = (value: number) => (value <= 0 ? 0 : Math.max(1, Math.round(value * k)));
  const labelIndexes = new Set([0, Math.floor((count - 1) / 2), count - 1]);
  const totalReports = shown.reduce((sum, day) => sum + day.reports, 0);
  const totalTaps = shown.reduce((sum, day) => sum + day.taps, 0);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pulse-chart"
      role="img"
      aria-label={`Daily signal since patch publish: ${totalReports} structured reports and ${totalTaps} one-tap confirmations across ${shown.length} days.`}
    >
      <line x1="0" y1={plotHeight} x2={width} y2={plotHeight} stroke="rgba(236,227,208,0.28)" strokeWidth="1" />
      {shown.map((day, index) => {
        const x = leftPad + index * pitch;
        const tapsHeight = scaled(day.taps);
        const reportsHeight = scaled(day.reports);
        return (
          <g key={day.day}>
            {tapsHeight > 0 ? (
              <rect x={x} y={plotHeight - tapsHeight} width={barW} height={tapsHeight} fill="var(--bar-taps)" />
            ) : null}
            {reportsHeight > 0 ? (
              <rect
                x={x + barW + 2}
                y={plotHeight - reportsHeight}
                width={barW}
                height={reportsHeight}
                fill="var(--bar-reports)"
              />
            ) : null}
            {labelsInSvg && labelIndexes.has(index) ? (
              <text
                x={x}
                y={height - 8}
                fontFamily="var(--font-mono)"
                fontSize="10.5"
                fill="var(--dispatch-quiet)"
              >
                {shortDate(day.day)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function PulseDataTable({ series, maxDays }: { series: DailySignalDay[]; maxDays: number }) {
  const shown = series.slice(-maxDays);
  return (
    <div className="sr-only">
      <table aria-label="Daily Patch Pulse signal by day">
        <caption>Daily Patch Pulse signal by day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Structured reports</th>
            <th scope="col">One-tap confirmations</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>{day.reports}</td>
              <td>{day.taps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DispatchHomePage() {
  const [d, radar, series, edition] = await Promise.all([
    getDashboardData(),
    getPublicScannerData(),
    getDailySignalRollup(),
    getTrackedPatchEditionCount(),
  ]);

  const patch = d.currentPatch;
  const patchFamily = patchFamilyKey(patch.version) ?? patch.version;
  const totalTaps = d.topClusters.reduce((sum, cluster) => sum + cluster.confirmations.totalCount, 0);

  // Clusters whose fix claim the lifecycle pass tied to the current patch.
  const verifying = d.topClusters.filter(
    (cluster) => cluster.fix_claimed_patch_version === patch.version,
  );
  /**
   * Claims record attribution: a verbatim claim gets a verdict split only when
   * the stored categories join it to exactly one verifying cluster and that
   * category has exactly one claim (1:1). There is no claim→cluster foreign
   * key, so anything more would be a fabricated association.
   */
  const attributedByCategory = uniqueClaimAttributions(d.claimedFixes, verifying);
  const claimRows = d.claimedFixes.map((claim) => {
    const attributed = claim.category === null ? null : attributedByCategory.get(claim.category) ?? null;
    const poll = attributed?.readout.poll ?? null;
    const clockSince =
      shortDate(attributed?.fix_claimed_at ?? null) ?? shortDate(patch.publishedAt) ?? "PATCH PUBLISH";
    return { claim, attributed, poll, clockSince };
  });
  const contestedClusters = verifying.filter((cluster) => {
    if (attributedByCategory.get(cluster.category)?.id !== cluster.id) return false;
    const poll = cluster.readout.poll;
    return poll !== null && poll.stillCount > poll.fixedCount && poll.stillCount > 0;
  });
  const mostContested = contestedClusters.reduce<(typeof contestedClusters)[number] | null>(
    (best, cluster) =>
      !best || (cluster.readout.poll?.stillCount ?? 0) > (best.readout.poll?.stillCount ?? 0) ? cluster : best,
    null,
  );

  const brief = composeDispatchBrief({
    patchVersion: patch.version,
    publishedAt: patch.publishedAt,
    reports: d.total,
    taps: totalTaps,
    keptLeadsThisWeek: radar.keptThisWeek,
    contested: mostContested
      ? {
          title: mostContested.title,
          stillCount: mostContested.readout.poll?.stillCount ?? 0,
          fixedCount: mostContested.readout.poll?.fixedCount ?? 0,
        }
      : null,
    claimedFixCount: d.claimedFixes.length,
    contestedClaimCount: contestedClusters.length,
    series,
  });

  // Issue board: the same published-entry gate used by /issues, top three by evidence strength.
  const boardClusters = d.topClusters.filter(needsFullIssueCard);
  const top3 = boardClusters.slice(0, 3);
  const [leadStory, ...secondaryStories] = top3;

  const verdictsElsewhere = verifying.length > 0 && claimRows.every((row) => row.attributed === null);
  const mobileClaimRow =
    claimRows.find((row) => row.attributed && mostContested && row.attributed.id === mostContested.id) ??
    claimRows[0] ??
    null;

  const wire = d.observations.slice(0, 3);
  const publishedDateLabel = mediumDate(patch.publishedAt);

  const tocRows: { href: string; label: string; index: string }[] = [
    {
      href: "#pulse",
      label: `Patch Pulse — signal since ${mediumDate(patch.publishedAt) ?? patch.version}`,
      index: "01",
    },
    {
      href: "#board",
      label:
        top3.length > 0
          ? `The issue board, top ${top3.length === 3 ? "three" : top3.length === 2 ? "two" : "story"}`
          : "The issue board",
      index: "02",
    },
  ];
  if (claimRows.length > 0) tocRows.push({ href: "#claims", label: "The claims record", index: "03" });
  if (wire.length > 0) tocRows.push({ href: "#wire", label: "From the wire", index: "04" });

  function statusLine(cluster: (typeof d.topClusters)[number], withCategory: boolean) {
    const tone = cluster.readout.tone;
    return (
      <div className={`status-line status-line--${tone}`}>
        <span className="status-line__dot" aria-hidden="true" />
        <span className={`status-line__label--${tone}`}>{cluster.readout.label.toUpperCase()}</span>
        {withCategory ? (
          <span className="status-line__meta">
            · {(CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category).toUpperCase()}
          </span>
        ) : null}
      </div>
    );
  }

  function platformMeters(cluster: (typeof d.topClusters)[number]) {
    const entries = Object.entries(cluster.reportPlatformCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (entries.length === 0) return null;
    const max = Math.max(...entries.map(([, count]) => count), 1);
    return (
      <div className="platform-meters">
        {entries.map(([platform, reports]) => {
          const confirms = cluster.confirmations.byPlatform[platform]?.count ?? 0;
          return (
            <div key={platform} className="platform-meter">
              <span>{PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform}</span>
              <div className="platform-meter__track">
                <div className="platform-meter__fill" style={{ width: `${Math.round((reports / max) * 100)}%` }} />
              </div>
              <span className="platform-meter__count">
                {reports} rpt · {confirms} confirm
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  function tapControl(cluster: (typeof d.topClusters)[number]) {
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
        storageScope={ask.kinds.includes("have_it") ? patchFamily : patch.version}
        question={ask.question}
        kinds={ask.kinds}
        counts={counts}
      />
    );
  }

  function verdictSplit(poll: { fixedCount: number; stillCount: number }, note: string | null) {
    const total = poll.fixedCount + poll.stillCount;
    if (total === 0) return null;
    const fixedPct = Math.round((poll.fixedCount / total) * 100);
    return (
      <>
        <div className="verdict-bar" role="presentation">
          <div className="verdict-bar__fixed" style={{ width: `${fixedPct}%` }} />
          <div className="verdict-bar__still" style={{ width: `${100 - fixedPct}%` }} />
        </div>
        <div className="verdict-labels">
          <span className="verdict-labels__fixed">
            {poll.fixedCount} fixed for me
          </span>
          <span className="verdict-labels__still">{poll.stillCount} still happening</span>
        </div>
        {note ? <div className="verdict-note">{note}</div> : null}
      </>
    );
  }

  function verdictNote(poll: { fixedCount: number; stillCount: number }): string {
    if (poll.stillCount > poll.fixedCount)
      return "Contested. Verdicts count taps made after the claim clock, this patch only.";
    if (poll.fixedCount > poll.stillCount)
      return "Leaning fixed. Verdicts count taps made after the claim clock, this patch only.";
    return "Split. Verdicts count taps made after the claim clock, this patch only.";
  }

  return (
    <PublicShell active="brief" masthead edition={edition}>
      <div className="dispatch-container">
        {/* Lead */}
        <section className="brief-lead" aria-label="Lead story">
          <div className="brief-lead__copy">
            <p className="dispatch-kicker">{brief.kicker}</p>
            <h2 className="brief-lead__headline">{brief.headline}</h2>
            <p className="brief-lead__dek">{brief.dek}</p>
            <p className="brief-lead__meta dispatch-desktop-only">
              {d.total} player reports · {totalTaps} player taps · {radar.keptThisWeek} kept leads · updated{" "}
              {timeAgo(d.latestReportAt)}
            </p>
            <div className="brief-fact-strip dispatch-mobile-only">
              <span>{d.total} reports</span>
              <span>{totalTaps} taps</span>
              <span>
                {d.claimedFixes.length} claims · {contestedClusters.length} contested
              </span>
            </div>
          </div>
          <div className="brief-lead__rail">
            <div>
              <h2 className="record-block__header">The Record</h2>
              <div className="record-block__row">
                <span>Current patch</span>
                <span className="record-block__value">{patch.version}</span>
              </div>
              <div className="record-block__row">
                <span>Published</span>
                <span className="record-block__value">{publishedDateLabel ?? "not recorded"}</span>
              </div>
              <div className="record-block__row">
                <span>Claimed fixes</span>
                <span className="record-block__value">{d.claimedFixes.length}</span>
              </div>
              <div className="record-block__row">
                <span>Player verdict</span>
                <span
                  className={
                    contestedClusters.length > 0
                      ? "record-block__value record-block__value--amber"
                      : "record-block__value"
                  }
                >
                  {d.claimedFixes.length === 0
                    ? "no claims"
                    : `${contestedClusters.length} of ${d.claimedFixes.length} contested`}
                </span>
              </div>
              <div className="record-block__row">
                <span>Official notes</span>
                <span className="record-block__value">
                  <a
                    className="dispatch-link"
                    href={patch.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {officialHost(patch.officialUrl)} ↗
                  </a>
                </span>
              </div>
            </div>
            <div>
              <h2 className="record-block__header record-block__header--again">In This Edition</h2>
              {tocRows.map((row) => (
                <a key={row.href} href={row.href} className="record-block__toc-row">
                  <span>{row.label}</span>
                  <span className="record-block__index">{row.index}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* 01 · Patch Pulse */}
        <section id="pulse" className="brief-band" aria-label="Patch Pulse">
          <div className="pulse-grid">
            <div className="pulse-main">
              <div className="brief-band__kicker-row">
                <h2 className="dispatch-kicker">01 · Patch Pulse</h2>
                <span className="brief-band__caption dispatch-desktop-only">
                  reports + taps per day since {patch.version}
                </span>
              </div>
              <p className="pulse-headline">{brief.pulseHeadline}</p>
              {series === null ? (
                <p className="brief-band__caption">
                  Daily series unavailable right now — the counts above are still live.
                </p>
              ) : (
                <>
                  <div className="dispatch-desktop-only">
                    <PulseChart
                      series={series}
                      width={824}
                      height={176}
                      plotHeight={150}
                      maxDays={14}
                      barWidth={18}
                      leftPad={24}
                      labelsInSvg
                    />
                  </div>
                  <div className="dispatch-mobile-only">
                    <PulseChart
                      series={series}
                      width={350}
                      height={64}
                      plotHeight={62}
                      maxDays={14}
                      barWidth={10}
                      leftPad={6}
                      labelsInSvg={false}
                    />
                    <div className="pulse-axis-row">
                      <span>{shortDate(series[0]?.day ?? null)}</span>
                      <span>{shortDate(series[series.length - 1]?.day ?? null)}</span>
                    </div>
                  </div>
                </>
              )}
              <div className="pulse-legend dispatch-desktop-only">
                <span>
                  <i className="pulse-legend__reports" aria-hidden="true" />
                  structured reports
                </span>
                <span>
                  <i className="pulse-legend__taps" aria-hidden="true" />
                  one-tap confirmations
                </span>
              </div>
              {series !== null ? <PulseDataTable series={series} maxDays={14} /> : null}
            </div>
            <div className="pulse-stats">
              <div className="pulse-stat">
                <div className="pulse-stat__value">{formatWeeklyDelta(brief)}</div>
                <div className="pulse-stat__caption">{weeklyDeltaSentence(brief)}</div>
              </div>
              <div className="pulse-stat pulse-stat--secondary">
                <div className="pulse-stat__value pulse-stat__value--crimson">
                  {mostContested?.readout.poll?.stillCount ?? 0}
                </div>
                <div className="pulse-stat__caption">
                  {mostContested
                    ? `Players still tapping "still happening" on ${mostContested.title}.`
                    : "No claimed fix is contested by player taps right now."}
                </div>
              </div>
              <div className="pulse-stat pulse-stat--secondary">
                <div className="pulse-stat__value">{radar.keptThisWeek}</div>
                <div className="pulse-stat__caption">
                  Public leads kept by the radar this week, out of {radar.reviewedThisWeek} reviewed.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 · Issue board */}
        <section id="board" className="brief-band" aria-label="The issue board">
          <div className="brief-band__header">
            <h2 className="dispatch-kicker">02 · The Issue Board</h2>
            <span style={{ fontSize: 13 }}>
              <Link href="/issues" className="dispatch-link">
                All {boardClusters.length} published issue{boardClusters.length === 1 ? "" : "s"} →
              </Link>
            </span>
          </div>
          {top3.length === 0 ? (
            <div className="board-empty">
              <p>
                No published issues yet for {patch.version}. Publishing needs a player report or corroborated
                sources —{" "}
                <Link href="/about" className="dispatch-link">
                  read the method
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="board-grid">
              {leadStory ? (
                <article className="board-lead">
                  {statusLine(leadStory, true)}
                  <h3 className="board-lead__title">{leadStory.title}</h3>
                  <p className="board-secondary__meta dispatch-mobile-only">
                    {leadStory.directReportCount} reports · {leadStory.confirmations.totalCount} taps
                  </p>
                  <p className="board-lead__summary">{leadStory.description}</p>
                  <div className="dispatch-desktop-only">{platformMeters(leadStory)}</div>
                  {tapControl(leadStory)}
                </article>
              ) : null}
              {secondaryStories.map((cluster) => (
                <article key={cluster.id} className="board-secondary">
                  {statusLine(cluster, false)}
                  <h3 className="board-secondary__title">{cluster.title}</h3>
                  <p className="board-secondary__summary">{cluster.description}</p>
                  <p className="board-secondary__meta">
                    {cluster.directReportCount} reports · {cluster.confirmations.totalCount} taps ·{" "}
                    {(CATEGORY_LABELS[cluster.category as keyof typeof CATEGORY_LABELS] ?? cluster.category).toLowerCase()}
                  </p>
                  <span className="board-secondary__link">
                    <Link href="/issues" className="dispatch-link">
                      Read the story →
                    </Link>
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 03 · Claims record */}
        {claimRows.length > 0 ? (
          <section id="claims" className="brief-band" aria-label="The claims record">
            <h2 className="dispatch-kicker">03 · The Claims Record</h2>
            <p className="claims-intro">
              What {patch.version} claims to fix, against what players say. The board never decides for them.
            </p>
            {claimRows.map((row, index) => (
              <div
                key={`${row.claim.fixText}-${index}`}
                className={
                  mobileClaimRow && row === mobileClaimRow ? "claim-row" : "claim-row claim-row--overflow"
                }
              >
                <blockquote className="claim-row__quote">&ldquo;{row.claim.fixText}&rdquo;</blockquote>
                <div className="claim-row__verdict">
                  {row.poll && row.poll.fixedCount + row.poll.stillCount > 0 ? (
                    verdictSplit(row.poll, verdictNote(row.poll))
                  ) : row.attributed ? (
                    <div className="verdict-clock">
                      No player verdicts yet · claim clock running since {row.clockSince}
                    </div>
                  ) : verdictsElsewhere ? (
                    <div className="verdict-note">
                      Player verdicts for this patch are tracked per issue on the{" "}
                      <Link href="/issues" className="dispatch-link">
                        issue board
                      </Link>
                      ; the notes don&apos;t tie this exact line to one issue.
                    </div>
                  ) : (
                    <div className="verdict-clock">
                      No player verdicts yet · claim clock running since {row.clockSince}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* 04 · From the wire */}
        {wire.length > 0 ? (
          <section id="wire" className="brief-band" aria-label="From the wire">
            <div className="brief-band__header">
              <h2 className="dispatch-kicker">04 · From The Wire</h2>
              <span className="brief-band__note dispatch-desktop-only">
                Reviewed coverage from trusted domains. Context — never evidence.
              </span>
            </div>
            <div className="wire-grid">
              {wire.map((observation, index) => (
                <article
                  key={observation.id}
                  className={index === 0 ? "wire-item" : "wire-item wire-item--overflow"}
                >
                  <p className="wire-item__meta">
                    {observation.sourceDomain ?? "source"} · {timeAgo(observation.observedAt)}
                    {observation.seenCount > 1 ? ` · seen ${observation.seenCount}×` : ""}
                  </p>
                  <a
                    className="wire-item__title"
                    href={observation.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {observation.title}
                  </a>
                  {observation.snippet ? <p className="wire-item__summary">{observation.snippet}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Observatory footnote — the page's only box */}
        <div className="dispatch-inset-box observatory-footnote">
          <div>
            <p className="observatory-footnote__label">From the Observatory</p>
            <p className="observatory-footnote__copy dispatch-desktop-only">
              The radar reviewed <span className="num-ink">{radar.reviewedThisWeek}</span> public candidates this
              week, kept <span className="num-ink">{radar.keptThisWeek}</span>, published{" "}
              <span className="num-ink">{radar.published}</span>.
            </p>
            <p className="observatory-footnote__copy dispatch-mobile-only">
              Radar this week: <span className="num-ink">{radar.reviewedThisWeek}</span> reviewed ·{" "}
              <span className="num-ink">{radar.keptThisWeek}</span> kept
            </p>
          </div>
          <span className="observatory-footnote__link">
            <Link href="/scanner" className="dispatch-link">
              Visit the Observatory →
            </Link>
          </span>
        </div>
      </div>
    </PublicShell>
  );
}
