import type { ReactNode } from "react";
import { DayScrubber, type ScrubItem } from "./DayScrubber";
import { MeasureTabs } from "./MeasureTabs";
import { dayLabel, MonthAxis, PatchLabels, Plot, type ChartPatch } from "./chartParts";
import {
  axisTicks,
  bandPath,
  columnRects,
  linePath,
  niceCeiling,
  patchMarkers,
  slotCenter,
  type AxisTick,
} from "@/lib/activityCharts";
import { rollingReviewShares, utcDay, type ActivityDay, type ActivityHistory, type LaneState } from "@/lib/activityHistory";
import { patchTypeLabel } from "@/lib/dispatchBrief";

const DAY_MS = 86_400_000;
const number = (value: number) => Math.round(value).toLocaleString("en-US");

type Release = { version: string; day: string; update: boolean };

/** Which update was live on a day, and any release that day. */
function releaseContext(day: string, releases: Release[]): string {
  const today = releases.filter((release) => release.day === day);
  if (today.length) return today.map((release) => `${release.update ? "update" : "hotfix"} ${release.version} released`).join(", ");
  const live = releases.findLast((release) => release.update && release.day < day);
  if (!live) return "";
  const after = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${live.day}T00:00:00Z`)) / DAY_MS);
  return `${after} ${after === 1 ? "day" : "days"} after update ${live.version}`;
}

type Lane = {
  id: "reviews" | "twitch" | "players";
  label: string;
  title: string;
  how: string;
  state: LaneState;
  emptyText: string;
  unavailableText: string;
  recorded: (day: ActivityDay) => boolean;
  describe: (day: ActivityDay) => string;
  draw: (days: ActivityDay[]) => { ticks: AxisTick[]; marks: ReactNode };
};

function lanes(history: ActivityHistory): Lane[] {
  return [
    {
      id: "reviews",
      label: "New reviews a day",
      title: "New Steam reviews a day",
      how: "The net change in Steam's review total, recorded once a day.",
      state: history.lanes.reviews,
      emptyText: "No Steam review totals are recorded yet.",
      unavailableText: "Steam review totals could not be read.",
      recorded: (day) => day.newReviews !== null,
      describe: (day) => day.newReviews === null ? "no review record" : `${number(day.newReviews)} new ${day.newReviews === 1 ? "review" : "reviews"}`,
      draw: (days) => {
        const values = days.map((day) => day.newReviews);
        const max = niceCeiling(Math.max(0, ...values.map((value) => value ?? 0)));
        return {
          ticks: axisTicks(0, max),
          marks: columnRects(values, max).map((rect) => <rect key={rect.index} className="dd-column" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />),
        };
      },
    },
    {
      id: "twitch",
      label: "Twitch viewers",
      title: "Watching on Twitch",
      how: "Average live viewers each day, sampled hourly.",
      state: history.lanes.twitch,
      emptyText: "No Twitch viewer counts are recorded yet.",
      unavailableText: "Twitch viewer counts could not be read.",
      recorded: (day) => day.twitchAvg !== null,
      describe: (day) => day.twitchAvg === null ? "no Twitch record" : `${number(day.twitchAvg)} average viewers, peak ${number(day.twitchPeak ?? 0)}`,
      draw: (days) => {
        const values = days.map((day) => day.twitchAvg);
        const max = niceCeiling(Math.max(0, ...values.map((value) => value ?? 0)));
        return {
          ticks: axisTicks(0, max),
          marks: (
            <>
              <path className="dd-wash" d={bandPath(values.map((value) => (value === null ? null : 0)), values, 0, max)} />
              <path className="dd-line" d={linePath(values, 0, max)} vectorEffect="non-scaling-stroke" />
            </>
          ),
        };
      },
    },
    {
      id: "players",
      label: "Steam players",
      title: "Playing on Steam",
      how: "The daily range and average, sampled every two hours. Steam only: other platforms and offline play are not counted.",
      state: history.lanes.players,
      emptyText: "No Steam player counts are recorded yet.",
      unavailableText: "Steam player counts could not be read.",
      recorded: (day) => day.playersAvg !== null,
      describe: (day) => day.playersAvg === null ? "no Steam player record" : `${number(day.playersMin ?? 0)} to ${number(day.playersMax ?? 0)} playing, average ${number(day.playersAvg)}`,
      draw: (days) => {
        const max = niceCeiling(Math.max(0, ...days.map((day) => day.playersMax ?? 0)));
        return {
          ticks: axisTicks(0, max),
          marks: (
            <>
              <path className="dd-wash" d={bandPath(days.map((day) => day.playersMin), days.map((day) => day.playersMax), 0, max)} />
              <path className="dd-line" d={linePath(days.map((day) => day.playersAvg), 0, max)} vectorEffect="non-scaling-stroke" />
            </>
          ),
        };
      },
    },
  ];
}

function LaneChart({ lane, history, patches, releases }: { lane: Lane; history: ActivityHistory; patches: ChartPatch[]; releases: Release[] }) {
  const first = history.days.findIndex(lane.recorded);
  if (lane.state === "unavailable") return <p className="dd-panel-state np-error">{lane.unavailableText}</p>;
  if (first < 0) return <p className="dd-panel-state">{lane.emptyText}</p>;
  // Each measure starts on its first recorded day, so no chart opens on an empty stretch.
  const days = history.days.slice(first);
  const markers = patchMarkers(days, patches);
  const { ticks, marks } = lane.draw(days);
  const items: ScrubItem[] = days.map((day, index) => ({
    x: slotCenter(index, days.length),
    title: dayLabel(day.day),
    detail: [lane.describe(day), releaseContext(day.day, releases)].filter(Boolean).join(" · "),
  }));
  const lastRecorded = days.findLastIndex(lane.recorded);
  const since = first === 0 ? `Shown for the last ${days.length} days.` : `Recorded since ${dayLabel(days[0].day)}.`;
  return (
    <>
      <p className="dd-measure-title"><strong>{lane.title}</strong> <span>{lane.how} {since}{markers.length ? "" : " No official release since then."}</span></p>
      <DayScrubber id={`day-${lane.id}`} label="Move through the days" items={items} initialIndex={lastRecorded}>
        <PatchLabels markers={markers} />
        <Plot ticks={ticks} markers={markers}>{marks}</Plot>
        <MonthAxis days={days} />
      </DayScrubber>
    </>
  );
}

export function UpdateTimeline({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  const days = history.days;
  if (days.length === 0) {
    return <p className="np-error">The activity record could not be read. No counts are assumed to be zero.</p>;
  }
  const releases: Release[] = patches
    .flatMap((patch) => {
      const time = patch.publishedAt ? Date.parse(patch.publishedAt) : Number.NaN;
      return Number.isFinite(time) ? [{ patch, time }] : [];
    })
    .sort((a, b) => a.time - b.time)
    .map(({ patch, time }) => ({ version: patch.version, day: utcDay(time), update: patchTypeLabel(patch.version) === "UPDATE" }));
  const rolling = rollingReviewShares(days);
  const releasesOn = (day: string) => releases.filter((release) => release.day === day).map((release) => release.version).join(", ");

  return (
    <figure className="dd-figure dd-timeline" aria-labelledby="timeline-title">
      <figcaption className="dd-figcaption">
        <h3 id="timeline-title">Day by day</h3>
        <p>One measure at a time, each from the day its records start. Labelled lines mark official updates; short ticks mark hotfixes.</p>
      </figcaption>
      <MeasureTabs
        id="timeline"
        label="Measure"
        tabs={lanes(history).map((lane) => ({ id: lane.id, label: lane.label, content: <LaneChart lane={lane} history={history} patches={patches} releases={releases} /> }))}
      />
      <details className="dd-table">
        <summary>Read the daily numbers</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Daily records, UTC. A blank cell was not recorded.</caption>
            <thead>
              <tr><th scope="col">Day</th><th scope="col">Release</th><th scope="col">New reviews</th><th scope="col">Positive, 7 days</th><th scope="col">Twitch avg</th><th scope="col">Twitch peak</th><th scope="col">Players min</th><th scope="col">Players avg</th><th scope="col">Players max</th></tr>
            </thead>
            <tbody>
              {days.map((day, index) => ({ day, index })).reverse().map(({ day, index }) => (
                <tr key={day.day}>
                  <th scope="row">{dayLabel(day.day)}</th>
                  <td>{releasesOn(day.day)}</td>
                  <td>{day.newReviews === null ? "" : number(day.newReviews)}</td>
                  <td>{rolling[index] === null ? "" : `${rolling[index]!.toFixed(1)}%`}</td>
                  <td>{day.twitchAvg === null ? "" : number(day.twitchAvg)}</td>
                  <td>{day.twitchPeak === null ? "" : number(day.twitchPeak)}</td>
                  <td>{day.playersMin === null ? "" : number(day.playersMin)}</td>
                  <td>{day.playersAvg === null ? "" : number(day.playersAvg)}</td>
                  <td>{day.playersMax === null ? "" : number(day.playersMax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="dd-source">Steam review totals are recorded once a day, Steam players every two hours, Twitch viewers every hour. These are context, not player reports.</p>
    </figure>
  );
}
