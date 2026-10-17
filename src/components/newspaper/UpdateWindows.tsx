import type { CSSProperties } from "react";
import { dayLabel, type ChartPatch } from "./chartParts";
import type { ActivityHistory } from "@/lib/activityHistory";
import {
  firstRecordedDay,
  MEASURES,
  MIN_DAYS,
  omittedUpdates,
  SAME_PERCENT,
  SAME_POINTS,
  updateWindows,
  WINDOW_DAYS,
  type Comparison,
  type Measure,
  type OmittedUpdate,
  type Side,
  type UpdateWindow,
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
      return `too close to ${side.neighbor}`;
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

/** How a change reads inside the takeaway, after the comparison is named once. */
function moved(measure: Measure, { change, direction }: Comparison): string {
  if (direction === "same" || direction === null) return "about the same";
  if (measure === "share") return `${Math.abs(change ?? 0).toFixed(1)} points ${direction === "up" ? "better" : "worse"}`;
  return change === null ? direction : `${direction} ${Math.round(Math.abs(change))}%`;
}

/**
 * One plain sentence for an update: what was recorded in the week after it
 * against the week before. It reports movement and never says why.
 */
export function takeaway(window: UpdateWindow, measures: Measure[]): string | null {
  const compared = measures.filter((measure) => window.measures[measure].after.state === "value" && window.measures[measure].direction !== null);
  if (!compared.length) return null;
  const parts = compared.map((measure) => {
    const comparison = window.measures[measure];
    const value = comparison.after.state === "value" ? format(measure, comparison.after.value) : "";
    switch (measure) {
      case "reviews":
        return `new reviews averaged ${value} a day, ${moved(measure, comparison)}`;
      case "share":
        return `${value} of ${compared.includes("reviews") ? "them" : "new reviews"} were positive, ${moved(measure, comparison)}`;
      case "twitch":
        return `Twitch viewers averaged ${value}, ${moved(measure, comparison)}`;
      case "players":
        return `Steam players averaged ${value}, ${moved(measure, comparison)}`;
    }
  });
  const after = window.measures[compared[0]].after;
  // A side that a neighboring update cut short is named by its length, never as a week.
  const span = after.state === "value" && after.open
    ? `In the ${days(after.days)} so far after ${window.version}`
    : window.span.after < WINDOW_DAYS ? `In the ${days(window.span.after)} after ${window.version}` : `In the week after ${window.version}`;
  const before = window.span.before < WINDOW_DAYS ? `the ${days(window.span.before)} before` : "the week before";
  return `${span} (${dayLabel(window.publishedAt.slice(0, 10))}), against ${before}: ${parts.join("; ")}.`;
}

/** Why a measure has no column: a failed read, no records, or records that start too late. */
function missingNote(measure: Measure, history: ActivityHistory): { text: string; failed: boolean } {
  if (history.lanes[measure === "share" ? "reviews" : measure] === "unavailable") return { text: `${RECORDS[measure]} could not be read.`, failed: true };
  const first = firstRecordedDay(history.days, measure);
  if (!first) return { text: `${RECORDS[measure]} are not recorded yet.`, failed: false };
  return { text: `${RECORDS[measure]} begin on ${dayLabel(first)}, so no update has ${MIN_DAYS} recorded days on both sides yet.`, failed: false };
}

/** Why an update inside the days shown has no comparison at all. */
function omittedText(update: OmittedUpdate, dayCount: number): string {
  return update.reason === "today"
    ? `${update.version} was released today, so the week after it has not begun.`
    : `${update.version} (${dayLabel(update.day)}) came less than a week into the last ${dayCount} days shown, so its week before falls outside them.`;
}

export function UpdateWindows({ history, patches }: { history: ActivityHistory; patches: ChartPatch[] }) {
  if (history.days.length === 0) return null;
  const windows = updateWindows(history, patches);
  if (windows.length === 0) {
    // An update left out for want of records is not an empty release record.
    const omitted = omittedUpdates(history, patches);
    return (
      <p className="obs-note">
        {omitted.length
          ? omitted.map((update) => omittedText(update, history.days.length)).join(" ")
          : "No official update was released in the recorded days, so there is nothing to compare yet."}
      </p>
    );
  }
  // A measure gets a column once an update compares it, or while an update's week
  // after is still filling against a recorded week before, so its card says
  // "too early to tell". Any other measure gets a note instead of a column of gaps.
  const shown = MEASURES.filter((measure) => windows.some((window) => {
    const { before, after, direction } = window.measures[measure];
    return direction !== null || (before.state === "value" && after.state === "early");
  }));
  const notes = [...new Map(MEASURES.filter((measure) => !shown.includes(measure))
    .map((measure) => missingNote(measure, history))
    .map((note) => [note.text, note])).values()];
  // The newest update with a comparison leads in words.
  const lead = windows.map((window) => takeaway(window, shown)).find((sentence) => sentence !== null) ?? null;
  return (
    <figure className="dd-figure dd-updates" aria-labelledby="update-windows-title" style={{ "--dd-cols": Math.max(1, shown.length) } as CSSProperties}>
      <figcaption className="dd-figcaption">
        <h3 id="update-windows-title">Update by update</h3>
        {lead ? <p className="dd-takeaway">{lead}</p> : null}
        <p>
          Each value reads week before → week after: {WINDOW_DAYS} days on each side, leaving out the release day and today. A week stops
          early when another update arrives, and each side needs {MIN_DAYS} days of records.
        </p>
      </figcaption>
      {shown.length ? (
        <div className="dd-cards-head" aria-hidden="true">
          <span className="dd-cards-head-update">Update</span>
          <span className="dd-cards-head-window">Week before → week after</span>
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
