import type { ReactNode } from "react";
import { DayScrubber, type ScrubItem } from "./DayScrubber";
import {
  axisTicks,
  bandPath,
  CHART_WIDTH,
  columnRects,
  linePath,
  monthTicks,
  niceCeiling,
  patchMarkers,
  PANEL_HEIGHT,
  shortVersion,
  slotCenter,
  type AxisTick,
  type PatchMarker,
} from "@/lib/activityCharts";
import { reviewShare, rollingReviewShares, type ActivityDay, type ActivityHistory, type LaneState } from "@/lib/activityHistory";

export type ChartPatch = { version: string; publishedAt: string | null; fixes: number };

const number = (value: number) => Math.round(value).toLocaleString("en-US");
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function PatchLines({ markers }: { markers: PatchMarker[] }) {
  return markers.map((marker) => (
    <line
      key={marker.version}
      className={"dd-patch-line" + (marker.update ? " is-update" : "")}
      x1={(marker.x / 100) * CHART_WIDTH}
      x2={(marker.x / 100) * CHART_WIDTH}
      y1={0}
      y2={PANEL_HEIGHT}
      vectorEffect="non-scaling-stroke"
    />
  ));
}

export function PatchLabels({ markers }: { markers: PatchMarker[] }) {
  return (
    <div className="dd-patch-strip" aria-hidden="true">
      {markers.map((marker) => (
        <span
          key={marker.version}
          className={"dd-patch-tick" + (marker.update ? " is-update" : "")}
          style={{ left: `${marker.x}%` }}
        >
          {marker.label ? <span className={"dd-patch-label" + (marker.label === "wide" ? " is-wide-only" : "")}>{shortVersion(marker.version)}</span> : null}
        </span>
      ))}
    </div>
  );
}

export function MonthAxis({ days }: { days: { day: string }[] }) {
  return (
    <div className="dd-months" aria-hidden="true">
      {monthTicks(days).map((tick) => <span key={tick.label} style={{ left: `${tick.x}%` }}>{tick.label}</span>)}
    </div>
  );
}

function Panel({
  title,
  unit,
  state,
  emptyText,
  unavailableText,
  ticks,
  markers,
  children,
  note,
}: {
  title: string;
  unit: string;
  state: LaneState;
  emptyText: string;
  unavailableText: string;
  ticks: AxisTick[];
  markers: PatchMarker[];
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="dd-panel">
      <p className="dd-panel-title"><strong>{title}</strong> <span>{unit}</span></p>
      <div className="dd-panel-plot">
        {state === "ready" ? (
          <>
            <div className="dd-yaxis" aria-hidden="true">
              {ticks.map((tick) => <span key={tick.value} style={{ top: `${tick.top}%` }}>{tick.label}</span>)}
            </div>
            <svg viewBox={`0 0 ${CHART_WIDTH} ${PANEL_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {ticks.map((tick) => (
                <line key={tick.value} className={tick === ticks[0] ? "dd-baseline" : "dd-gridline"} x1={0} x2={CHART_WIDTH}
                  y1={(tick.top / 100) * PANEL_HEIGHT} y2={(tick.top / 100) * PANEL_HEIGHT} vectorEffect="non-scaling-stroke" />
              ))}
              <PatchLines markers={markers} />
              {children}
            </svg>
            {note}
          </>
        ) : (
          <p className={state === "unavailable" ? "dd-panel-state np-error" : "dd-panel-state"}>{state === "unavailable" ? unavailableText : emptyText}</p>
        )}
      </div>
    </div>
  );
}

function readout(day: ActivityDay, rolling: number | null, releases: PatchMarker[]): string {
  const parts = [
    day.twitchAvg === null ? "Twitch not recorded" : `Twitch ${number(day.twitchAvg)} average viewers, peak ${number(day.twitchPeak ?? 0)}`,
    day.newReviews === null ? "reviews not recorded" : `${number(day.newReviews)} new Steam reviews${rolling === null ? "" : `, ${rolling.toFixed(1)}% positive over 7 days`}`,
    day.playersAvg === null ? "Steam players not recorded" : `Steam players ${number(day.playersMin ?? 0)} to ${number(day.playersMax ?? 0)}, average ${number(day.playersAvg)}`,
  ];
  if (releases.length) parts.push(`release ${releases.map((marker) => `${marker.version} (${marker.fixes} listed ${marker.fixes === 1 ? "fix" : "fixes"})`).join(", ")}`);
  return parts.join(" · ");
}

export function PatchSeismograph({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  const days = history.days;
  if (days.length === 0) {
    return <p className="np-error">The activity record could not be read. No counts are assumed to be zero.</p>;
  }
  const rolling = rollingReviewShares(days);
  const period = reviewShare(days, 5);
  const markers = patchMarkers(days, patches);
  const releasesOn = (day: string) => markers.filter((marker) => marker.publishedAt.slice(0, 10) === day);
  const twitch = days.map((day) => day.twitchAvg);
  const twitchMax = niceCeiling(Math.max(0, ...twitch.map((value) => value ?? 0)));
  const reviews = days.map((day) => day.newReviews);
  const reviewMax = niceCeiling(Math.max(0, ...reviews.map((value) => value ?? 0)));
  const playerMax = niceCeiling(Math.max(0, ...days.map((day) => day.playersMax ?? 0)));
  const zeros = days.map((day) => (day.twitchAvg === null ? null : 0));
  const firstPlayerIndex = days.findIndex((day) => day.playerCaptures > 0);
  const items: ScrubItem[] = days.map((day, index) => ({
    x: slotCenter(index, days.length),
    title: dayLabel(day.day),
    detail: readout(day, rolling[index], releasesOn(day.day)),
  }));
  const lastRecorded = days.findLastIndex((day) => day.twitchAvg !== null || day.newReviews !== null || day.playersAvg !== null);
  // Where the period's positive share sits on the 60–100% axis, as a fraction from the top.
  const periodTop = period ? 1 - (Math.min(100, Math.max(60, period.share)) - 60) / 40 : null;

  return (
    <figure className="dd-figure" aria-labelledby="seismograph-title">
      <figcaption className="dd-figcaption">
        <h3 id="seismograph-title">The patch seismograph</h3>
        <p>Four records on one timeline, {dayLabel(days[0].day)} to {dayLabel(days.at(-1)!.day)}. Red lines mark official releases; the labelled ones are updates, the short ones hotfixes. Each panel has its own scale.</p>
      </figcaption>
      <DayScrubber id="seismograph" label="Move through the days" items={items} initialIndex={lastRecorded < 0 ? days.length - 1 : lastRecorded}>
        <PatchLabels markers={markers} />
        <Panel title="Watching on Twitch" unit="average viewers, sampled hourly" state={history.lanes.twitch}
          emptyText="No Twitch captures in this window." unavailableText="Twitch viewer counts could not be read."
          ticks={axisTicks(0, twitchMax)} markers={markers}>
          <path className="dd-wash" d={bandPath(zeros, twitch, 0, twitchMax)} />
          <path className="dd-line" d={linePath(twitch, 0, twitchMax)} vectorEffect="non-scaling-stroke" />
        </Panel>
        <Panel title="New Steam reviews" unit="net change per day" state={history.lanes.reviews}
          emptyText="No Steam review records in this window." unavailableText="Steam review totals could not be read."
          ticks={axisTicks(0, reviewMax)} markers={markers}>
          {columnRects(reviews, reviewMax).map((rect) => <rect key={rect.index} className="dd-column" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />)}
        </Panel>
        <Panel title="Share positive" unit="new reviews, 7-day rolling" state={history.lanes.reviews}
          emptyText="No Steam review records in this window." unavailableText="Steam review totals could not be read."
          ticks={axisTicks(60, 100, (value) => `${value}%`)} markers={markers}
          note={period && periodTop !== null ? <span className="dd-reference-label" style={{ top: `${periodTop * 100}%` }}>Period average {period.share.toFixed(1)}%</span> : null}>
          {periodTop !== null ? <line className="dd-reference" x1={0} x2={CHART_WIDTH} y1={periodTop * PANEL_HEIGHT} y2={periodTop * PANEL_HEIGHT} vectorEffect="non-scaling-stroke" /> : null}
          <path className="dd-line" d={linePath(rolling, 60, 100)} vectorEffect="non-scaling-stroke" />
        </Panel>
        <Panel title="Playing on Steam" unit="daily range and average" state={history.lanes.players}
          emptyText="No Steam player captures in this window." unavailableText="Steam player counts could not be read."
          ticks={axisTicks(0, playerMax)} markers={markers}
          note={firstPlayerIndex > 0 ? <span className="dd-panel-note" style={{ width: `${(firstPlayerIndex / days.length) * 100}%` }}>Recorded from {dayLabel(days[firstPlayerIndex].day)}</span> : null}>
          <path className="dd-wash" d={bandPath(days.map((day) => day.playersMin), days.map((day) => day.playersMax), 0, playerMax)} />
          <path className="dd-line" d={linePath(days.map((day) => day.playersAvg), 0, playerMax)} vectorEffect="non-scaling-stroke" />
        </Panel>
        <MonthAxis days={days} />
      </DayScrubber>
      <details className="dd-table">
        <summary>Read the daily numbers</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Daily records, UTC. A blank cell was not recorded.</caption>
            <thead>
              <tr><th scope="col">Day</th><th scope="col">Release</th><th scope="col">Twitch avg</th><th scope="col">Twitch peak</th><th scope="col">New reviews</th><th scope="col">Positive, 7 days</th><th scope="col">Players min</th><th scope="col">Players avg</th><th scope="col">Players max</th></tr>
            </thead>
            <tbody>
              {days.map((day, index) => ({ day, index })).reverse().map(({ day, index }) => (
                <tr key={day.day}>
                  <th scope="row">{dayLabel(day.day)}</th>
                  <td>{releasesOn(day.day).map((marker) => marker.version).join(", ")}</td>
                  <td>{day.twitchAvg === null ? "" : number(day.twitchAvg)}</td>
                  <td>{day.twitchPeak === null ? "" : number(day.twitchPeak)}</td>
                  <td>{day.newReviews === null ? "" : number(day.newReviews)}</td>
                  <td>{rolling[index] === null ? "" : `${rolling[index]!.toFixed(1)}%`}</td>
                  <td>{day.playersMin === null ? "" : number(day.playersMin)}</td>
                  <td>{day.playersAvg === null ? "" : number(day.playersAvg)}</td>
                  <td>{day.playersMax === null ? "" : number(day.playersMax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="dd-source">Steam review totals are recorded once a day, Steam players every two hours, Twitch viewers every hour. Steam players exclude other platforms and offline play. These are context, not player reports.</p>
    </figure>
  );
}
