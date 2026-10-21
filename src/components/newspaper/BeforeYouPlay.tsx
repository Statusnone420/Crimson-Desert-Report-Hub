import { ReadingLink } from "./ReadingLink";
import { CHART_WIDTH, PANEL_HEIGHT, timeBandPath, timeLinePath } from "@/lib/activityCharts";
import {
  completeDays,
  reviewShare,
  typicalPlayers,
  usualRangeAt,
  utcDay,
  utcWeekStart,
  weeklyReviewShares,
  type ActivityHistory,
} from "@/lib/activityHistory";
import type { BoardWatchRead } from "@/lib/boardWatch";
import { CATEGORY_LABELS } from "@/lib/constants";
import { formatUtcTimestamp } from "@/lib/editorials/content";
import { EXPANSION } from "@/lib/expansion";

const DAY_MS = 86_400_000;
const number = (value: number) => Math.round(value).toLocaleString("en-US");
// Dated in full, so a capture from an earlier day never reads as today's.
const captureLabel = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}, ${date.toISOString().slice(11, 16)} UTC`;
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
  // The week ends at the reading, not at the latest capture, so captures that stopped show their age.
  const checked = Date.parse(history.checkedAt);
  const to = Number.isFinite(checked) ? Math.max(checked, latestTime) : latestTime;
  const from = to - 7 * DAY_MS;
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
  // A usual of zero has no percentage to compare against.
  const difference = typical && typical.median > 0 ? (latest.playerCount / typical.median - 1) * 100 : null;
  return (
    <div className="dd-tile">
      <p className="dd-tile-label">Playing on Steam</p>
      <p className="dd-tile-value">{number(latest.playerCount)}</p>
      <p className="dd-tile-sub">Latest capture, {captureLabel(latest.capturedAt)}</p>
      <p className="dd-tile-delta">
        {typical && difference !== null
          ? `${Math.abs(difference).toFixed(0)}% ${difference < 0 ? "below" : "above"} the usual for a ${typical.weekday} at this time (median of the last ${typical.samples}: ${number(typical.median)}).`
          : typical
            ? `The usual for a ${typical.weekday} at this time is 0 (median of the last ${typical.samples}), so no percentage is given.`
            : "Not enough earlier weeks yet to say what is usual for this time."}
      </p>
      {recent.length ? (
        <>
          <div className="dd-spark">
            <svg viewBox={`0 0 ${CHART_WIDTH} ${PANEL_HEIGHT}`} preserveAspectRatio="none" role="img"
              aria-label={`Steam players over the last 7 days, from ${number(Math.min(...recent.map((point) => point.value)))} to ${number(Math.max(...recent.map((point) => point.value)))}, with the usual range at each time of day shaded.`}>
              <path className="dd-band" d={timeBandPath(ranges, from, to, max, maxGap)} />
              <path className="dd-line" d={timeLinePath(recent, from, to, max, maxGap)} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="dd-spark-dot" style={{ left: `${((latestTime - from) / (to - from)) * 100}%`, top: `${(1 - latest.playerCount / max) * 100}%` }} aria-hidden="true" />
          </div>
          <p className="dd-tile-note">Line: the last 7 days. Shaded: the usual range at that time of day in earlier weeks.</p>
        </>
      ) : <p className="dd-tile-note">No Steam player capture in the last 7 days.</p>}
    </div>
  );
}

function MoodTile({ history, now }: { history: ActivityHistory; now: number }) {
  if (history.lanes.reviews === "unavailable") {
    return <div className="dd-tile"><p className="dd-tile-label">Steam mood, last 7 days</p><p className="np-error">Steam review totals could not be read.</p></div>;
  }
  // The last 7 full days, as on the Observatory: today's partial day is left out.
  const lastDays = completeDays(history).slice(-7);
  const recent = reviewShare(lastDays, 3);
  const lifetime = history.days.findLast((day) => day.lifetimePositive !== null)?.lifetimePositive ?? null;
  const weeks = weeklyReviewShares(history.days, 12);
  if (!recent) {
    return <div className="dd-tile"><p className="dd-tile-label">Steam mood, last 7 days</p><p className="dd-tile-sub">Not enough daily review records in the last 7 days to give a share.</p></div>;
  }
  const slot = CHART_WIDTH / Math.max(1, weeks.length);
  // A week without a share has no bar, so the last bar is this week's only when its week is this one.
  const current = Number.isFinite(now) && weeks.at(-1)?.weekStart === utcWeekStart(utcDay(now));
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
              return <rect key={week.weekStart} className={index === weeks.length - 1 && current ? "dd-column" : "dd-column is-quiet"} x={index * slot + (slot - width) / 2} y={PANEL_HEIGHT - height} width={width} height={height} />;
            })}
          </svg>
        </div>
      ) : null}
      <p className="dd-tile-note">Bars: each week&apos;s share since {dateLabel(weeks[0]?.weekStart ?? history.days[0].day)}, axis from 60%. {current ? "The dark bar is this week so far." : "This week has no share yet."}</p>
    </div>
  );
}

// Steam's review totals are recorded a few times a day, so today's net change is a partial day.
function TodayReviewsTile({ history, now }: { history: ActivityHistory; now: number }) {
  const label = <p className="dd-tile-label">Steam reviews, today so far</p>;
  if (history.lanes.reviews === "unavailable") {
    return <div className="dd-tile">{label}<p className="np-error">Steam review totals could not be read.</p></div>;
  }
  // Today by the page's clock: records read before UTC midnight hold no row for it.
  const index = history.days.findIndex((day) => day.day === utcDay(now));
  const today = index < 0 ? undefined : history.days[index];
  if (!today || today.newReviews === null) {
    return <div className="dd-tile">{label}<p className="dd-tile-sub">No review record for today yet.</p></div>;
  }
  const share = reviewShare([today]);
  const yesterday = index > 0 ? reviewShare([history.days[index - 1]]) : null;
  return (
    <div className="dd-tile">
      {label}
      <p className="dd-tile-value">{today.newReviews.toLocaleString("en-US")}</p>
      <p className="dd-tile-sub">
        {share ? `new Steam reviews, ${share.share.toFixed(0)}% positive.`
          : today.newReviews > 0 ? "new Steam reviews."
            : today.newReviews < 0 ? "More reviews were removed than added." : "Steam’s review total hasn’t changed today."}
      </p>
      {yesterday ? <p className="dd-tile-delta">Yesterday, a full day: {number(yesterday.total)} new, {yesterday.share.toFixed(0)}% positive.</p> : null}
      <ReadingLink variant="quiet" className="dd-tile-link" href="/observatory#review-record">Read the review record</ReadingLink>
    </div>
  );
}

type LatestPatch = { version: string; publishedAt: string | null; fixes: number | null; notesUnavailable?: boolean };

function PatchTile({ patch, now, launchAt }: { patch: LatestPatch | null; now: number; launchAt?: string }) {
  if (!patch) return <div className="dd-tile"><p className="dd-tile-label">Latest official patch</p><p className="np-error">The official patch record could not be read.</p></div>;
  // Days between UTC calendar dates, to match the date shown beside them.
  const published = patch.publishedAt ? Date.parse(patch.publishedAt) : Number.NaN;
  // Release-day notes can land hours before the release itself.
  const olderThanLaunch = launchAt !== undefined && Number.isFinite(published) && published < Date.parse(launchAt) - DAY_MS;
  const days = Number.isFinite(published) && Number.isFinite(now)
    ? Math.round((Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${utcDay(published)}T00:00:00Z`)) / DAY_MS)
    : null;
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
      {olderThanLaunch ? <p className="dd-tile-delta">No patch notes on the Hub since launch day yet.</p> : null}
      <ReadingLink variant="quiet" className="dd-tile-link" href="/catch-up">What changed since you last played</ReadingLink>
    </div>
  );
}

/**
 * The front page's readings. For launch week (`launch` set) they lead the page as the launch
 * watch: today's reviews replace the 7-day mood, and the patch tile says when no notes came since.
 * `now` is the page's render time, for words such as "today" and "this week". The history's own
 * read time, which can be an hour older, still decides which days were complete when read.
 */
export function BeforeYouPlay({
  history,
  latestPatch,
  watch,
  launch,
  now,
}: {
  history: ActivityHistory;
  latestPatch: LatestPatch | null;
  watch: BoardWatchRead;
  launch?: { at: string };
  now: number;
}) {
  const summary = watch === "unavailable" ? null : watch;
  const systems = summary?.systems.slice(0, 3).map((system) => `${CATEGORY_LABELS[system.category].toLowerCase()} ${system.threads}`).join(", ");
  return (
    <section className="dd-brief" id={launch ? "launch-watch" : undefined} aria-labelledby="before-you-play-title">
      {launch ? (
        <div className="dd-brief-heading">
          <p className="kicker">Launch watch</p>
          <h2 id="before-you-play-title">{EXPANSION.name} is out</h2>
          <p className="dd-brief-deck">Out since <time dateTime={launch.at}>{formatUtcTimestamp(launch.at)}</time>. Players, reviews, patches and forum threads for launch week.</p>
        </div>
      ) : (
        <div className="dd-brief-heading">
          <p className="kicker">Before you play</p>
          <h2 id="before-you-play-title">The latest readings</h2>
          <p className="dd-brief-deck">Recorded data from Steam and the official notes, updated after each scan. It describes the game&apos;s activity, not whether a problem is fixed.</p>
        </div>
      )}
      <div className="dd-tiles">
        <PlayersTile history={history} />
        {launch ? <TodayReviewsTile history={history} now={now} /> : <MoodTile history={history} now={now} />}
        <PatchTile patch={latestPatch} now={now} launchAt={launch?.at} />
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
      {launch ? (
        <div className="dd-brief-links">
          <ReadingLink variant="quiet" href={EXPANSION.path}>Open the expansion desk</ReadingLink>
          <ReadingLink variant="quiet" href="/observatory#updates">Open the data desk</ReadingLink>
        </div>
      ) : <ReadingLink variant="quiet" className="dd-brief-link" href="/observatory#updates">Open the data desk</ReadingLink>}
    </section>
  );
}
