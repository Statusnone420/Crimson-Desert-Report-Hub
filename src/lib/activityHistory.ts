/**
 * Daily aggregates for the public activity charts. Steam players, Twitch
 * viewers and Steam review totals are recorded context, never player evidence.
 * Every figure here is built from stored captures; a day without a capture
 * stays empty and is never filled in.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type ActivityLane = "players" | "twitch" | "reviews";
export type LaneState = "ready" | "empty" | "unavailable";

export type PlayerCapture = { capturedAt: string; playerCount: number };

export type ActivityDay = {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  playersMin: number | null;
  playersMax: number | null;
  playersAvg: number | null;
  playerCaptures: number;
  twitchAvg: number | null;
  twitchPeak: number | null;
  twitchCaptures: number;
  /** Steam's lifetime review total and positive share as recorded that day. */
  totalReviews: number | null;
  lifetimePositive: number | null;
  /** Net change since the previous day's record; null without a record on both days. */
  newReviews: number | null;
  newPositive: number | null;
};

export type ActivityHistory = {
  checkedAt: string;
  days: ActivityDay[];
  /** Every player capture in the window, oldest first. */
  playerCaptures: PlayerCapture[];
  lanes: Record<ActivityLane, LaneState>;
};

export type ReviewRecord = { day: string; totalReviews: number; totalPositive: number; positivePercentage: number };
export type TwitchCapture = { capturedAt: string; liveViewers: number };

export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function finiteTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizePlayerRows(rows: Record<string, unknown>[], from: number, to: number): PlayerCapture[] {
  return rows.flatMap((row) => {
    const time = finiteTime(row.captured_at);
    const playerCount = nonNegativeInteger(row.player_count);
    return time !== null && time >= from && time <= to && playerCount !== null
      ? [{ capturedAt: new Date(time).toISOString(), playerCount }]
      : [];
  }).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

/** Complete captures only, the latest in each UTC hour, as the public Twitch history reads them. */
export function normalizeTwitchRows(rows: Record<string, unknown>[], from: number, to: number): TwitchCapture[] {
  const byHour = new Map<number, { time: number; liveViewers: number }>();
  for (const row of rows) {
    const time = finiteTime(row.captured_at);
    const liveViewers = nonNegativeInteger(row.twitch_live_viewers);
    if (time === null || time < from || time > to || liveViewers === null) continue;
    if (row.twitch_status !== "ok" || row.twitch_complete !== true) continue;
    const hour = Math.floor(time / HOUR_MS);
    const kept = byHour.get(hour);
    if (!kept || time > kept.time) byHour.set(hour, { time, liveViewers });
  }
  return [...byHour.values()]
    .sort((a, b) => a.time - b.time)
    .map(({ time, liveViewers }) => ({ capturedAt: new Date(time).toISOString(), liveViewers }));
}

export function normalizeReviewRows(rows: Record<string, unknown>[]): ReviewRecord[] {
  return rows.flatMap((row) => {
    const day = typeof row.snapshot_day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.snapshot_day) ? row.snapshot_day : null;
    const totalReviews = nonNegativeInteger(row.total_reviews);
    const totalPositive = nonNegativeInteger(row.total_positive);
    const positivePercentage = Number(row.positive_percentage);
    if (!day || totalReviews === null || totalPositive === null || totalPositive > totalReviews || !Number.isFinite(positivePercentage)) return [];
    return [{ day, totalReviews, totalPositive, positivePercentage }];
  }).sort((a, b) => a.day.localeCompare(b.day));
}

export function buildActivityDays(input: {
  from: number;
  to: number;
  players: PlayerCapture[];
  twitch: TwitchCapture[];
  reviews: ReviewRecord[];
}): ActivityDay[] {
  const reviewsByDay = new Map(input.reviews.map((record) => [record.day, record]));
  const days: ActivityDay[] = [];
  for (let start = Date.parse(`${utcDay(input.from)}T00:00:00Z`); start <= input.to; start += DAY_MS) {
    const day = utcDay(start);
    const players = input.players.filter((capture) => utcDay(Date.parse(capture.capturedAt)) === day).map((capture) => capture.playerCount);
    const viewers = input.twitch.filter((capture) => utcDay(Date.parse(capture.capturedAt)) === day).map((capture) => capture.liveViewers);
    const record = reviewsByDay.get(day) ?? null;
    const previous = reviewsByDay.get(utcDay(start - DAY_MS)) ?? null;
    const newReviews = record && previous ? record.totalReviews - previous.totalReviews : null;
    const newPositive = record && previous ? record.totalPositive - previous.totalPositive : null;
    days.push({
      day,
      playersMin: players.length ? Math.min(...players) : null,
      playersMax: players.length ? Math.max(...players) : null,
      playersAvg: players.length ? players.reduce((sum, value) => sum + value, 0) / players.length : null,
      playerCaptures: players.length,
      twitchAvg: viewers.length ? viewers.reduce((sum, value) => sum + value, 0) / viewers.length : null,
      twitchPeak: viewers.length ? Math.max(...viewers) : null,
      twitchCaptures: viewers.length,
      totalReviews: record?.totalReviews ?? null,
      lifetimePositive: record?.positivePercentage ?? null,
      newReviews,
      newPositive,
    });
  }
  return days;
}

/** A day whose net change can be read as a share: more new reviews than removals, and a sane positive count. */
function readableChange(day: ActivityDay): day is ActivityDay & { newReviews: number; newPositive: number } {
  return day.newReviews !== null && day.newPositive !== null && day.newReviews > 0
    && day.newPositive >= 0 && day.newPositive <= day.newReviews;
}

export type ReviewShare = { positive: number; total: number; share: number; days: number };

/** Positive share of the net new reviews across the given days, or null below `minDays` readable days. */
export function reviewShare(days: ActivityDay[], minDays = 1): ReviewShare | null {
  const readable = days.filter(readableChange);
  const total = readable.reduce((sum, day) => sum + day.newReviews, 0);
  const positive = readable.reduce((sum, day) => sum + day.newPositive, 0);
  return readable.length >= minDays && total > 0 ? { positive, total, share: (positive / total) * 100, days: readable.length } : null;
}

/** Seven-day rolling share for each day; it needs five readable days in the window. */
export function rollingReviewShares(days: ActivityDay[], window = 7, minDays = 5): (number | null)[] {
  return days.map((_, index) => reviewShare(days.slice(Math.max(0, index - window + 1), index + 1), minDays)?.share ?? null);
}

export type WeeklyShare = ReviewShare & { weekStart: string };

/** Monday-start UTC weeks, oldest first, the last one possibly partial. */
export function weeklyReviewShares(days: ActivityDay[], weeks: number): WeeklyShare[] {
  const groups = new Map<string, ActivityDay[]>();
  for (const day of days) {
    const time = Date.parse(`${day.day}T00:00:00Z`);
    const weekStart = utcDay(time - ((new Date(time).getUTCDay() + 6) % 7) * DAY_MS);
    groups.set(weekStart, [...(groups.get(weekStart) ?? []), day]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([weekStart, group]) => {
      const share = reviewShare(group);
      return share ? [{ weekStart, ...share }] : [];
    })
    .slice(-weeks);
}

export type TypicalPlayers = { median: number; samples: number; weekday: string };

/**
 * The usual player count for the latest capture's weekday and time: the median
 * of the captures nearest the same moment one to four weeks earlier, each within
 * an hour. Captures every two hours can fall either side of the hour, so two
 * equally near captures are averaged. Fewer than three earlier weeks: no figure.
 */
export function typicalPlayers(captures: PlayerCapture[], weeks = 4, minSamples = 3): TypicalPlayers | null {
  const latest = captures.at(-1);
  if (!latest) return null;
  const latestTime = Date.parse(latest.capturedAt);
  const samples: number[] = [];
  for (let week = 1; week <= weeks; week += 1) {
    const target = latestTime - week * 7 * DAY_MS;
    const near = captures.filter((capture) => Math.abs(Date.parse(capture.capturedAt) - target) <= HOUR_MS);
    if (!near.length) continue;
    const best = Math.min(...near.map((capture) => Math.abs(Date.parse(capture.capturedAt) - target)));
    const nearest = near.filter((capture) => Math.abs(Date.parse(capture.capturedAt) - target) === best);
    samples.push(nearest.reduce((sum, capture) => sum + capture.playerCount, 0) / nearest.length);
  }
  if (samples.length < minSamples) return null;
  const sorted = samples.sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { median, samples: samples.length, weekday: new Date(latestTime).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) };
}

/**
 * The 25th to 75th percentile of earlier captures within an hour of the same
 * time of day, for a "usual range" band behind a recent line. Needs four.
 */
export function usualRangeAt(captures: PlayerCapture[], time: number, before: number): [number, number] | null {
  const hour = new Date(time).getUTCHours();
  const values = captures
    .filter((capture) => {
      const captureTime = Date.parse(capture.capturedAt);
      if (captureTime >= before) return false;
      const difference = Math.abs(new Date(captureTime).getUTCHours() - hour);
      return Math.min(difference, 24 - difference) <= 1;
    })
    .map((capture) => capture.playerCount)
    .sort((a, b) => a - b);
  if (values.length < 4) return null;
  const at = (q: number) => {
    const index = (values.length - 1) * q;
    const low = Math.floor(index), high = Math.ceil(index);
    return values[low] + (values[high] - values[low]) * (index - low);
  };
  return [at(0.25), at(0.75)];
}
