import type { ReactNode } from "react";
import { DayScrubber, type ScrubItem } from "./DayScrubber";
import { MeasureTabs } from "./MeasureTabs";
import { dayLabel, MonthAxis, PatchLabels, Plot, type ChartPatch } from "./chartParts";
import {
  axisTicks,
  bandPath,
  columnRects,
  linePath,
  lossRects,
  niceCeiling,
  patchMarkers,
  slotCenter,
  type AxisTick,
} from "@/lib/activityCharts";
import { completeDays, partialDay, rollingReviewShares, utcDay, type ActivityDay, type ActivityHistory, type LaneState } from "@/lib/activityHistory";
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
  /** The slider's own accessible name. */
  slider: string;
  title: string;
  how: (days: ActivityDay[]) => string;
  state: LaneState;
  emptyText: string;
  unavailableText: string;
  recorded: (day: ActivityDay) => boolean;
  describe: (day: ActivityDay) => string;
  /** `partial` is the index of today's day, drawn lighter and kept out of the lines. */
  draw: (days: ActivityDay[], partial: number | null) => { ticks: AxisTick[]; marks: ReactNode };
};

/** The values without today's partial one, plus a lighter segment that reaches it. */
function splitPartial(values: (number | null)[], partial: number | null) {
  if (partial === null) return { settled: values, reaching: null };
  const settled = values.map((value, index) => (index === partial ? null : value));
  const reaching = values.map((value, index) => (index === partial || index === partial - 1 ? value : null));
  return { settled, reaching };
}

function lanes(history: ActivityHistory): Lane[] {
  return [
    {
      id: "reviews",
      label: "New reviews a day",
      slider: "Choose a day: new Steam reviews",
      title: "New Steam reviews a day",
      how: (days) => `The net change in Steam's review total, recorded once a day.${days.some((day) => (day.newReviews ?? 0) < 0) ? " A short mark under the line means more reviews were removed than added." : ""}`,
      state: history.lanes.reviews,
      emptyText: "No Steam review totals are recorded yet.",
      unavailableText: "Steam review totals could not be read.",
      recorded: (day) => day.newReviews !== null,
      describe: (day) => {
        // A day's change needs the day before as well, so a recorded day can still have none.
        if (day.newReviews === null) return day.totalReviews === null ? "no review record" : "no change to show: the day before has no review record";
        if (day.newReviews < 0) return `net ${number(day.newReviews)} reviews: more were removed than added`;
        return `${number(day.newReviews)} new ${day.newReviews === 1 ? "review" : "reviews"}`;
      },
      draw: (days, partial) => {
        const values = days.map((day) => day.newReviews);
        const max = niceCeiling(Math.max(0, ...values.map((value) => value ?? 0)));
        const column = (rect: { index: number }) => "dd-column" + (rect.index === partial ? " is-partial" : "");
        return {
          ticks: axisTicks(0, max),
          marks: (
            <>
              {columnRects(values, max).map((rect) => <rect key={rect.index} className={column(rect)} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />)}
              {lossRects(values).map((rect) => <rect key={`loss-${rect.index}`} className={`${column(rect)} is-loss`} x={rect.x} y={rect.y} width={rect.width} height={rect.height} />)}
            </>
          ),
        };
      },
    },
    {
      id: "twitch",
      label: "Twitch viewers",
      slider: "Choose a day: Twitch viewers",
      title: "Watching on Twitch",
      how: () => "Average live viewers each day, sampled hourly.",
      state: history.lanes.twitch,
      emptyText: "No Twitch viewer counts are recorded yet.",
      unavailableText: "Twitch viewer counts could not be read.",
      recorded: (day) => day.twitchAvg !== null,
      describe: (day) => day.twitchAvg === null ? "no Twitch record" : `${number(day.twitchAvg)} average viewers, peak ${number(day.twitchPeak ?? 0)}`,
      draw: (days, partial) => {
        const values = days.map((day) => day.twitchAvg);
        const max = niceCeiling(Math.max(0, ...values.map((value) => value ?? 0)));
        const { settled, reaching } = splitPartial(values, partial);
        return {
          ticks: axisTicks(0, max),
          marks: (
            <>
              <path className="dd-wash" d={bandPath(settled.map((value) => (value === null ? null : 0)), settled, 0, max)} />
              <path className="dd-line" d={linePath(settled, 0, max)} vectorEffect="non-scaling-stroke" />
              {reaching ? <path className="dd-line is-partial" d={linePath(reaching, 0, max)} vectorEffect="non-scaling-stroke" /> : null}
            </>
          ),
        };
      },
    },
    {
      id: "players",
      label: "Steam players",
      slider: "Choose a day: Steam players",
      title: "Playing on Steam",
      how: () => "The daily range and average, sampled every two hours. Steam only: other platforms and offline play are not counted.",
      state: history.lanes.players,
      emptyText: "No Steam player counts are recorded yet.",
      unavailableText: "Steam player counts could not be read.",
      recorded: (day) => day.playersAvg !== null,
      describe: (day) => day.playersAvg === null ? "no Steam player record" : `${number(day.playersMin ?? 0)}–${number(day.playersMax ?? 0)} playing, average ${number(day.playersAvg)}`,
      draw: (days, partial) => {
        const max = niceCeiling(Math.max(0, ...days.map((day) => day.playersMax ?? 0)));
        const { settled, reaching } = splitPartial(days.map((day) => day.playersAvg), partial);
        const without = (value: number | null, index: number) => (index === partial ? null : value);
        return {
          ticks: axisTicks(0, max),
          marks: (
            <>
              <path className="dd-wash" d={bandPath(days.map((day, index) => without(day.playersMin, index)), days.map((day, index) => without(day.playersMax, index)), 0, max)} />
              <path className="dd-line" d={linePath(settled, 0, max)} vectorEffect="non-scaling-stroke" />
              {reaching ? <path className="dd-line is-partial" d={linePath(reaching, 0, max)} vectorEffect="non-scaling-stroke" /> : null}
            </>
          ),
        };
      },
    },
  ];
}

function LaneChart({ lane, history, patches, patchesUnavailable, releases }: {
  lane: Lane;
  history: ActivityHistory;
  patches: ChartPatch[];
  patchesUnavailable: boolean;
  releases: Release[];
}) {
  const first = history.days.findIndex(lane.recorded);
  if (lane.state === "unavailable") return <p className="dd-panel-state np-error">{lane.unavailableText}</p>;
  if (first < 0) return <p className="dd-panel-state">{lane.emptyText}</p>;
  // Each measure starts on its first recorded day, so no chart opens on an empty stretch.
  const days = history.days.slice(first);
  const today = partialDay(history);
  const partial = today !== null && days.at(-1)?.day === today ? days.length - 1 : null;
  const markers = patchMarkers(days, patches);
  const { ticks, marks } = lane.draw(days, partial);
  const items: ScrubItem[] = days.map((day, index) => ({
    x: slotCenter(index, days.length),
    title: index === partial ? `${dayLabel(day.day)}, today so far` : dayLabel(day.day),
    detail: [lane.describe(day), releaseContext(day.day, releases)].filter(Boolean).join(" · "),
  }));
  // Open on the latest full day; today's partial day is one step to the right.
  const lastComplete = days.findLastIndex((day, index) => index !== partial && lane.recorded(day));
  const since = first === 0 ? `Shown for the last ${days.length} days.` : `Recorded since ${dayLabel(days[0].day)}.`;
  // An unread patch record is not an empty one, so it never reads as "no release".
  const quiet = markers.length || patchesUnavailable ? "" : " No official release since then.";
  return (
    <>
      <p className="dd-measure-title"><strong>{lane.title}</strong> <span>{lane.how(days)} {since}{quiet}</span></p>
      <DayScrubber id={`day-${lane.id}`} label={lane.slider} items={items} initialIndex={lastComplete < 0 ? days.length - 1 : lastComplete}>
        <PatchLabels markers={markers} />
        <Plot ticks={ticks} markers={markers}>{marks}</Plot>
        <MonthAxis days={days} />
      </DayScrubber>
    </>
  );
}

export function UpdateTimeline({ history, patches, patchesUnavailable = false }: {
  history: ActivityHistory;
  patches: ChartPatch[];
  /** The official patch record could not be read, so `patches` is empty for want of data. */
  patchesUnavailable?: boolean;
}) {
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
  // Seven-day shares from full days only; today's row stays blank until the day is complete.
  const rolling = rollingReviewShares(completeDays(history));
  const today = partialDay(history);
  const releasesOn = (day: string) => releases.filter((release) => release.day === day).map((release) => release.version).join(", ");
  const marking = patchesUnavailable
    ? "Updates are not marked, because the official patch record could not be read."
    : "Labeled lines mark official updates; short ticks mark hotfixes.";

  return (
    <figure className="dd-figure dd-timeline" aria-labelledby="timeline-title">
      <figcaption className="dd-figcaption">
        <h3 id="timeline-title">Day by day</h3>
        <p>{`One measure at a time, each from the day its records start. ${marking} Today's partial day is drawn lighter.`}</p>
      </figcaption>
      <MeasureTabs
        id="timeline"
        label="Measure"
        tabs={lanes(history).map((lane) => ({
          id: lane.id,
          label: lane.label,
          content: <LaneChart lane={lane} history={history} patches={patches} patchesUnavailable={patchesUnavailable} releases={releases} />,
        }))}
      />
      <details className="dd-table">
        <summary>Read the daily numbers</summary>
        <div className="dd-table-scroll">
          <table>
            <caption>Daily records, UTC. A blank cell means no record, or no release that day. A day&apos;s change needs the day before, and the 7-day share needs 5 full days.</caption>
            <thead>
              <tr><th scope="col">Day</th>{patchesUnavailable ? null : <th scope="col">Release</th>}<th scope="col">New reviews</th><th scope="col">Positive, last 7 days</th><th scope="col">Twitch avg</th><th scope="col">Twitch peak</th><th scope="col">Players min</th><th scope="col">Players avg</th><th scope="col">Players max</th></tr>
            </thead>
            <tbody>
              {days.map((day, index) => ({ day, index })).reverse().map(({ day, index }) => (
                <tr key={day.day}>
                  <th scope="row">{day.day === today ? `${dayLabel(day.day)} (today so far)` : dayLabel(day.day)}</th>
                  {patchesUnavailable ? null : <td>{releasesOn(day.day)}</td>}
                  <td>{day.newReviews === null ? "" : number(day.newReviews)}</td>
                  <td>{rolling[index] == null ? "" : `${rolling[index]!.toFixed(1)}%`}</td>
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
