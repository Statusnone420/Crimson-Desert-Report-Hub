import { ReadingLink } from "./ReadingLink";
import { CHART_WIDTH, PANEL_HEIGHT, timeBandPath, timeLinePath } from "@/lib/activityCharts";
import {
  reviewShare,
  typicalPlayers,
  usualRangeAt,
  weeklyReviewShares,
  type ActivityHistory,
} from "@/lib/activityHistory";
import type { BoardWatchRead } from "@/lib/boardWatch";
import { CATEGORY_LABELS } from "@/lib/constants";

const DAY_MS = 86_400_000;
const number = (value: number) => Math.round(value).toLocaleString("en-US");
const captureLabel = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} ${date.toISOString().slice(11, 16)} UTC`;
};
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function PlayersTile({ history }: { history: ActivityHistory }) {
  const latest = history.playerCaptures.at(-1);
  if (history.lanes.players === "unavailable" || !latest) {
    return (
      <div className="dd-tile">
        <p className="dd-tile-label">Playing on Steam</p>
        <p className={history.lanes.players === "unavailable" ? "np-error" : "dd-tile-sub"}>
          {history.lanes.players === "unavailable" ? "Steam player counts could not be read." : "No Steam player capture is recorded yet."}
        </p>
      </div>
    );
  }
  const latestTime = Date.parse(latest.capturedAt);
  const typical = typicalPlayers(history.playerCaptures);
  const from = latestTime - 7 * DAY_MS;
  const recent = history.playerCaptures
    .filter((capture) => Date.parse(capture.capturedAt) > from)
    .map((capture) => ({ time: Date.parse(capture.capturedAt), value: capture.playerCount }));
  const ranges = recent.flatMap((point) => {
    const range = usualRangeAt(history.playerCaptures, point.time, from);
    return range ? [{ time: point.time, low: range[0], high: range[1] }] : [];
  });
  const max = Math.max(1, ...recent.map((point) => point.value), ...ranges.map((range) => range.high)) * 1.08;
  // Captures arrive every two hours; a longer silence breaks the line instead of bridging it.
  const maxGap = 3.25 * 3_600_000;
  const difference = typical ? (latest.playerCount / typical.median - 1) * 100 : null;
  return (
    <div className="dd-tile">
      <p className="dd-tile-label">Playing on Steam</p>
      <p className="dd-tile-value">{number(latest.playerCount)}</p>
      <p className="dd-tile-sub">Latest capture, {captureLabel(latest.capturedAt)}</p>
      <p className="dd-tile-delta">
        {typical && difference !== null
          ? `${Math.abs(difference).toFixed(0)}% ${difference < 0 ? "below" : "above"} the usual for a ${typical.weekday} at this time (median of the last ${typical.samples}: ${number(typical.median)}).`
          : "Not enough earlier weeks yet to say what is usual for this time."}
      </p>
      <div className="dd-spark">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${PANEL_HEIGHT}`} preserveAspectRatio="none" role="img"
          aria-label={`Steam players over the last 7 days, from ${number(Math.min(...recent.map((point) => point.value)))} to ${number(Math.max(...recent.map((point) => point.value)))}, with the usual range at each time of day shaded.`}>
          <path className="dd-band" d={timeBandPath(ranges, from, latestTime, max, maxGap)} />
          <path className="dd-line" d={timeLinePath(recent, from, latestTime, max, maxGap)} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="dd-spark-dot" style={{ left: "100%", top: `${(1 - latest.playerCount / max) * 100}%` }} aria-hidden="true" />
      </div>
      <p className="dd-tile-note">Line: the last 7 days. Shaded: the usual range at that time of day in earlier weeks.</p>
    </div>
  );
}

function MoodTile({ history }: { history: ActivityHistory }) {
  if (history.lanes.reviews === "unavailable") {
    return <div className="dd-tile"><p className="dd-tile-label">Steam mood, last 7 days</p><p className="np-error">Steam review totals could not be read.</p></div>;
  }
  const lastDays = history.days.slice(-7);
  const recent = reviewShare(lastDays, 3);
  const lifetime = history.days.findLast((day) => day.lifetimePositive !== null)?.lifetimePositive ?? null;
  const weeks = weeklyReviewShares(history.days, 12);
  if (!recent) {
    return <div className="dd-tile"><p className="dd-tile-label">Steam mood, last 7 days</p><p className="dd-tile-sub">Not enough daily review records this week to give a share.</p></div>;
  }
  const slot = CHART_WIDTH / Math.max(1, weeks.length);
  return (
    <div className="dd-tile">
      <p className="dd-tile-label">Steam mood, last 7 days</p>
      <p className="dd-tile-value">{recent.share.toFixed(0)}%</p>
      <p className="dd-tile-sub">of {number(recent.total)} new Steam reviews were positive.{lifetime !== null ? ` All-time score: ${lifetime}%.` : ""}</p>
      {weeks.length > 1 ? (
        <div className="dd-spark">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${PANEL_HEIGHT}`} preserveAspectRatio="none" role="img"
            aria-label={`Weekly share of positive new reviews: ${weeks.map((week) => `week of ${dateLabel(week.weekStart)} ${week.share.toFixed(0)}%`).join(", ")}.`}>
            {weeks.map((week, index) => {
              const height = (Math.min(100, Math.max(60, week.share)) - 60) / 40 * PANEL_HEIGHT;
              const width = Math.min(slot * 0.6, slot - 6);
              return <rect key={week.weekStart} className={index === weeks.length - 1 ? "dd-column" : "dd-column is-quiet"} x={index * slot + (slot - width) / 2} y={PANEL_HEIGHT - height} width={width} height={height} />;
            })}
          </svg>
        </div>
      ) : null}
      <p className="dd-tile-note">Bars: each week&apos;s share since {dateLabel(weeks[0]?.weekStart ?? history.days[0].day)}, axis from 60%. The dark bar is this week so far.</p>
    </div>
  );
}

type LatestPatch = { version: string; publishedAt: string | null; fixes: number | null; notesUnavailable?: boolean };

function PatchTile({ patch, now }: { patch: LatestPatch | null; now: number }) {
  if (!patch) return <div className="dd-tile"><p className="dd-tile-label">Latest official patch</p><p className="np-error">The official patch record could not be read.</p></div>;
  const days = patch.publishedAt ? Math.floor((now - Date.parse(patch.publishedAt)) / DAY_MS) : null;
  return (
    <div className="dd-tile">
      <p className="dd-tile-label">Latest official patch</p>
      <p className="dd-tile-value">{patch.version}</p>
      <p className="dd-tile-sub">
        {patch.publishedAt ? `${dateLabel(patch.publishedAt)}${days !== null && days >= 0 ? ` · ${days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`}` : ""} · ` : ""}
        {patch.fixes !== null
          ? `${patch.fixes} listed ${patch.fixes === 1 ? "fix" : "fixes"}`
          : patch.notesUnavailable ? "the official notes could not be read" : "official notes not listed yet"}
      </p>
      <ReadingLink variant="quiet" className="dd-tile-link" href="/catch-up">What changed since you last played</ReadingLink>
    </div>
  );
}

export function BeforeYouPlay({
  history,
  latestPatch,
  watch,
}: {
  history: ActivityHistory;
  latestPatch: LatestPatch | null;
  watch: BoardWatchRead;
}) {
  const now = Date.parse(history.checkedAt);
  const summary = watch === "unavailable" ? null : watch;
  const systems = summary?.systems.slice(0, 3).map((system) => `${CATEGORY_LABELS[system.category].toLowerCase()} ${system.threads}`).join(", ");
  return (
    <section className="dd-brief" aria-labelledby="before-you-play-title">
      <div className="dd-brief-heading">
        <p className="kicker">Before you play</p>
        <h2 id="before-you-play-title">The latest readings</h2>
        <p className="dd-brief-deck">Recorded data from Steam and the official notes, updated after each scan. It describes the game&apos;s activity, not whether a problem is fixed.</p>
      </div>
      <div className="dd-tiles">
        <PlayersTile history={history} />
        <MoodTile history={history} />
        <PatchTile patch={latestPatch} now={now} />
      </div>
      {summary && summary.threads > 0 ? (
        <div className="dd-watch">
          <p className="kicker">On the radar</p>
          <p>
            The scanner is watching <strong>{number(summary.topics)} {summary.topics === 1 ? "topic" : "topics"}</strong> from{" "}
            <strong>{number(summary.threads)} Steam forum {summary.threads === 1 ? "thread" : "threads"}</strong> first seen on {summary.patchVersion}
            {systems ? `. The most threads: ${systems}.` : "."} These are leads, not confirmed reports.
          </p>
          <ReadingLink variant="quiet" href="/issues">Read the issue board</ReadingLink>
        </div>
      ) : watch === "unavailable" ? (
        <div className="dd-watch">
          <p className="kicker">On the radar</p>
          <p className="np-error">The scanner&apos;s thread counts could not be read.</p>
        </div>
      ) : null}
      <ReadingLink variant="quiet" className="dd-brief-link" href="/observatory#updates">Open the data desk</ReadingLink>
    </section>
  );
}
