/**
 * The week before each official update against the week after it, built from
 * the same daily records as the activity charts. The release day is left out
 * because it mixes both sides, a week stops early at a neighbouring update, and
 * a side is compared only with enough recorded days. Movement around an update
 * is context, never proof the update caused it.
 */
import { patchTypeLabel } from "@/lib/dispatchBrief";
import { reviewShare, utcDay, type ActivityDay, type ActivityHistory, type LaneState } from "@/lib/activityHistory";

const DAY_MS = 86_400_000;
/** Days on each side of an update. */
export const WINDOW_DAYS = 7;
/** Recorded days a side needs before it is compared. */
export const MIN_DAYS = 5;
/** Smaller changes read as "about the same": percent for counts, points for the positive share. */
export const SAME_PERCENT = 10;
export const SAME_POINTS = 1;

export type Measure = "reviews" | "share" | "twitch" | "players";
export const MEASURES: Measure[] = ["reviews", "share", "twitch", "players"];

export type Side =
  | { state: "value"; value: number; days: number; open: boolean }
  | { state: "unavailable" }
  /** The week after the latest update is still filling. */
  | { state: "early"; days: number }
  /** A neighbouring update leaves too few days. */
  | { state: "close"; neighbour: string }
  | { state: "missing" }
  | { state: "few"; days: number };

export type Comparison = {
  before: Side;
  after: Side;
  /** Percent for counts, points for the positive share; null unless both sides have a value. */
  change: number | null;
  direction: "up" | "down" | "same" | null;
};

export type UpdateWindow = {
  version: string;
  publishedAt: string;
  fixes: number;
  /** Hotfixes released during the week after. */
  hotfixes: string[];
  measures: Record<Measure, Comparison>;
};

type Release = { version: string; publishedAt: string; fixes: number; day: string; update: boolean };

const shiftDay = (day: string, days: number) => utcDay(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const LANES: Record<Measure, keyof ActivityHistory["lanes"]> = { reviews: "reviews", share: "reviews", twitch: "twitch", players: "players" };

const COUNTS: Record<Exclude<Measure, "share">, (day: ActivityDay) => number | null> = {
  reviews: (day) => day.newReviews,
  twitch: (day) => day.twitchAvg,
  players: (day) => day.playersAvg,
};

/** Recorded days in the window and the side's value, or null below the minimum. */
function read(measure: Measure, days: ActivityDay[]): { days: number; value: number | null } {
  if (measure === "share") {
    const share = reviewShare(days, MIN_DAYS);
    return { days: reviewShare(days)?.days ?? 0, value: share?.share ?? null };
  }
  const values = days.map(COUNTS[measure]).filter((value): value is number => value !== null);
  return { days: values.length, value: values.length >= MIN_DAYS ? mean(values) : null };
}

function side(
  measure: Measure,
  lane: LaneState,
  window: { days: ActivityDay[]; length: number; open: boolean; neighbour: string | null },
): Side {
  if (lane === "unavailable") return { state: "unavailable" };
  if (window.length < MIN_DAYS) {
    return window.open || !window.neighbour ? { state: "early", days: window.length } : { state: "close", neighbour: window.neighbour };
  }
  const { days, value } = read(measure, window.days);
  if (value !== null) return { state: "value", value, days, open: window.open };
  if (days === 0) return window.open ? { state: "early", days: 0 } : { state: "missing" };
  return window.open ? { state: "early", days } : { state: "few", days };
}

function compare(measure: Measure, before: Side, after: Side): Comparison {
  if (before.state !== "value" || after.state !== "value") return { before, after, change: null, direction: null };
  if (measure === "share") {
    const change = after.value - before.value;
    return { before, after, change, direction: Math.abs(change) < SAME_POINTS ? "same" : change > 0 ? "up" : "down" };
  }
  if (before.value <= 0) {
    return { before, after, change: null, direction: after.value > before.value ? "up" : after.value < before.value ? "down" : "same" };
  }
  const change = (after.value / before.value - 1) * 100;
  return { before, after, change, direction: Math.abs(change) < SAME_PERCENT ? "same" : change > 0 ? "up" : "down" };
}

/**
 * One entry per official update (a missing or zero third version part) inside
 * the recorded days, newest first. An update whose week before reaches past the
 * first recorded day is left out rather than shown as unrecorded.
 */
export function updateWindows(
  history: ActivityHistory,
  patches: { version: string; publishedAt: string | null; fixes: number }[],
): UpdateWindow[] {
  const days = history.days;
  if (!days.length) return [];
  const first = days[0].day;
  const last = days.at(-1)!.day;
  const releases: Release[] = patches
    .flatMap((patch) => {
      const time = patch.publishedAt ? Date.parse(patch.publishedAt) : Number.NaN;
      return Number.isFinite(time) ? [{ patch, time }] : [];
    })
    .sort((a, b) => a.time - b.time)
    .map(({ patch, time }) => ({
      version: patch.version,
      publishedAt: patch.publishedAt!,
      fixes: patch.fixes,
      day: utcDay(time),
      update: patchTypeLabel(patch.version) === "UPDATE",
    }));
  const updates = releases.filter((release) => release.update);
  const between = (from: string, to: string) => days.filter((day) => day.day >= from && day.day <= to);

  return updates
    .flatMap((update, index) => {
      if (update.day > last) return [];
      const previous = updates[index - 1];
      const next = updates[index + 1];
      const beforeFrom = later(shiftDay(update.day, -WINDOW_DAYS), previous ? shiftDay(previous.day, 1) : "0000-01-01");
      const beforeTo = shiftDay(update.day, -1);
      if (beforeFrom < first) return [];
      const afterFrom = shiftDay(update.day, 1);
      const afterTo = earlier(shiftDay(update.day, WINDOW_DAYS), next ? shiftDay(next.day, -1) : "9999-12-31");
      const afterOpen = afterTo > last;
      const afterEnd = earlier(afterTo, last);
      const beforeWindow = { days: between(beforeFrom, beforeTo), length: Math.max(0, spanDays(beforeFrom, beforeTo)), open: false, neighbour: previous?.version ?? null };
      const afterWindow = { days: between(afterFrom, afterEnd), length: afterEnd < afterFrom ? 0 : spanDays(afterFrom, afterEnd), open: afterOpen, neighbour: next?.version ?? null };
      const measures = Object.fromEntries(MEASURES.map((measure) => {
        const lane = history.lanes[LANES[measure]];
        return [measure, compare(measure, side(measure, lane, beforeWindow), side(measure, lane, afterWindow))];
      })) as Record<Measure, Comparison>;
      const hotfixes = releases.filter((release) => !release.update && release.day >= afterFrom && release.day <= afterTo).map((release) => release.version);
      return [{ version: update.version, publishedAt: update.publishedAt, fixes: update.fixes, hotfixes, measures }];
    })
    .reverse();
}

/** The first recorded day for a measure, or null without any record. */
export function firstRecordedDay(days: ActivityDay[], measure: Measure): string | null {
  const recorded = measure === "share"
    ? days.find((day) => day.newReviews !== null && day.newReviews > 0)
    : days.find((day) => COUNTS[measure](day) !== null);
  return recorded?.day ?? null;
}
