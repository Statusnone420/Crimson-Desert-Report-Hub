import type { RadarDailyPoint } from "@/lib/radar.server";
import type { DailySignalDay } from "@/lib/queries";

/**
 * One day on the activity chart. Evidence (reports, taps) and radar
 * intelligence (newLeads, reobservations) stay separate series — the chart
 * renders them in separate lanes and they are never summed together.
 */
export type ActivityDay = {
  day: string;
  reports: number;
  taps: number;
  newLeads: number;
  reobservations: number;
};

export type ActivitySeries = {
  days: ActivityDay[];
  /** False when the daily_signal_rollup view was unreadable. */
  evidenceAvailable: boolean;
  /** False when the radar read model was unavailable (no scanner config). */
  radarAvailable: boolean;
};

/**
 * Merge the evidence rollup and the radar daily series over the union of
 * their day keys. Missing days on either side are literal zeros only when
 * that side's source was actually readable; an unavailable source is flagged
 * instead of faked.
 */
export function mergeActivitySeries(
  rollup: DailySignalDay[] | null,
  radarDaily: RadarDailyPoint[] | null,
): ActivitySeries {
  const evidenceAvailable = rollup !== null;
  const radarAvailable = radarDaily !== null && radarDaily.length > 0;
  const byDay = new Map<string, ActivityDay>();
  const ensure = (day: string): ActivityDay => {
    const existing = byDay.get(day);
    if (existing) return existing;
    const created = { day, reports: 0, taps: 0, newLeads: 0, reobservations: 0 };
    byDay.set(day, created);
    return created;
  };
  for (const row of rollup ?? []) {
    const point = ensure(row.day);
    point.reports = row.reports;
    point.taps = row.taps;
  }
  for (const row of radarDaily ?? []) {
    const point = ensure(row.day);
    point.newLeads = row.newLeads;
    point.reobservations = row.reobservations;
  }
  return {
    days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    evidenceAvailable,
    radarAvailable,
  };
}
