import type { CSSProperties } from "react";
import { dayLabel, type ChartPatch } from "./chartParts";
import type { ActivityHistory } from "@/lib/activityHistory";
import {
  firstRecordedDay,
  MEASURES,
  MIN_DAYS,
  SAME_PERCENT,
  SAME_POINTS,
  updateWindows,
  WINDOW_DAYS,
  type Comparison,
  type Measure,
  type Side,
} from "@/lib/patchWindows";

const LABELS: Record<Measure, string> = {
  reviews: "New reviews a day",
  share: "Positive share",
  twitch: "Twitch viewers",
  players: "Playing on Steam",
};

/** Each measure's records, named for the notes under the table. */
const RECORDS: Record<Measure, string> = {
  reviews: "Steam review totals",
  share: "Steam review totals",
  twitch: "Twitch viewer counts",
  players: "Steam player counts",
};

const MARKS = { up: "▲", down: "▼", same: "≈" } as const;

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
const fixes = (count: number) => `${count} listed ${count === 1 ? "fix" : "fixes"}`;

function format(measure: Measure, value: number): string {
  return measure === "share" ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString("en-US");
}

function changeText(measure: Measure, { change, direction }: Comparison): string {
  if (direction === "same" || direction === null) return "about the same";
  if (measure === "share") return `${Math.abs(change ?? 0).toFixed(1)} points ${direction === "up" ? "better" : "worse"}`;
  return change === null ? direction : `${direction} ${Math.round(Math.abs(change))}%`;
}

/** Why a side has no value; `alone` when the other side has one. */
function reason(side: Side, which: "before" | "after", alone: boolean): string {
  switch (side.state) {
    case "unavailable":
      return "could not be read";
    case "early":
      return side.days > 0 ? `too early to tell, ${days(side.days)} so far` : "too early to tell";
    case "close":
      return `too close to ${side.neighbour}`;
    case "missing":
      return alone ? `not recorded ${which}` : "not recorded yet";
    case "few":
      return `only ${days(side.days)} recorded ${which}`;
    default:
      return "";
  }
}

function Change({ measure, comparison }: { measure: Measure; comparison: Comparison }) {
  const { before, after, direction } = comparison;
  if (before.state === "value" && after.state === "value" && direction) {
    return (
      <>
        <span className="dd-change-values">{format(measure, before.value)} → {format(measure, after.value)}</span>
        <span className={`dd-change is-${direction}${measure === "share" ? " is-tone" : ""}`}>
          <i className="dd-change-mark" aria-hidden="true">{MARKS[direction]}</i> {changeText(measure, comparison)}{after.open ? " so far" : ""}
        </span>
      </>
    );
  }
  if (before.state === "value") {
    return <><span className="dd-change-values">{format(measure, before.value)} before</span><span className="dd-change-reason">{reason(after, "after", true)}</span></>;
  }
  if (after.state === "value") {
    return <><span className="dd-change-values">{format(measure, after.value)} after</span><span className="dd-change-reason">{reason(before, "before", true)}</span></>;
  }
  // Neither side: a week still filling says so first; otherwise the week before explains it.
  return <span className="dd-change-reason">{after.state === "early" ? reason(after, "after", false) : reason(before, "before", false)}</span>;
}

/** Why a measure has no column: a failed read, no records, or records that start too late. */
function missingNote(measure: Measure, history: ActivityHistory): { text: string; failed: boolean } {
  if (history.lanes[measure === "share" ? "reviews" : measure] === "unavailable") return { text: `${RECORDS[measure]} could not be read.`, failed: true };
  const first = firstRecordedDay(history.days, measure);
  if (!first) return { text: `${RECORDS[measure]} are not recorded yet.`, failed: false };
  return { text: `${RECORDS[measure]} begin on ${dayLabel(first)}, so no update has ${MIN_DAYS} recorded days on both sides yet.`, failed: false };
}

export function UpdateWindows({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  if (history.days.length === 0) return null;
  const windows = updateWindows(history, patches);
  if (windows.length === 0) {
    return <p className="obs-note">No official update was released in the recorded days, so there is nothing to compare yet.</p>;
  }
  // A measure without a single comparison gets a note instead of a column of gaps.
  const shown = MEASURES.filter((measure) => windows.some((window) => window.measures[measure].direction !== null));
  const notes = [...new Map(MEASURES.filter((measure) => !shown.includes(measure))
    .map((measure) => missingNote(measure, history))
    .map((note) => [note.text, note])).values()];
  return (
    <figure className="dd-figure dd-updates" aria-labelledby="update-windows-title" style={{ "--dd-cols": Math.max(1, shown.length) } as CSSProperties}>
      <figcaption className="dd-figcaption">
        <h3 id="update-windows-title">Update by update</h3>
        <p>Each official update&apos;s week before against its week after: {WINDOW_DAYS} days on each side, leaving out the release day. A week stops early when another update arrives, and each side needs {MIN_DAYS} days of records.</p>
      </figcaption>
      {shown.length ? (
        <div className="dd-cards-head" aria-hidden="true">
          <span>Update</span>
          {shown.map((measure) => <span key={measure}>{LABELS[measure]}</span>)}
        </div>
      ) : null}
      <ol className="dd-cards">
        {windows.map((window) => (
          <li key={window.version} className="dd-card">
            <div className="dd-card-update">
              <h4>{window.version}</h4>
              <p>
                {dayLabel(window.publishedAt.slice(0, 10))} · {fixes(window.fixes)}
                {window.hotfixes.length ? ` · then ${window.hotfixes.length === 1 ? "hotfix" : "hotfixes"} ${window.hotfixes.join(", ")}` : ""}
              </p>
            </div>
            {shown.length ? (
              <dl className="dd-card-measures">
                {shown.map((measure) => (
                  <div key={measure}>
                    <dt>{LABELS[measure]}</dt>
                    <dd><Change measure={measure} comparison={window.measures[measure]} /></dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
      {shown.length ? (
        <p className="dd-cards-key">
          Arrows show the direction of each change. For the positive share, <i className="dd-change-mark is-up" aria-hidden="true">▲</i> blue marks a better share and <i className="dd-change-mark is-down" aria-hidden="true">▼</i> red a worse one.
          {" "}Changes under {SAME_PERCENT}% ({SAME_POINTS} point for the positive share) read as about the same.
        </p>
      ) : null}
      {notes.map((note) => <p key={note.text} className={note.failed ? "np-error" : "dd-source"}>{note.text}</p>)}
    </figure>
  );
}
