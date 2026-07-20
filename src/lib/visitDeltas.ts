import type { ActivityDay } from "@/lib/activitySeries";

/**
 * Since-your-last-visit deltas. Pure math over the public aggregate series:
 * the previous-visit timestamp comes from THIS browser's localStorage and is
 * never sent anywhere. Deltas count whole days strictly after the previous
 * visit's day — they can undercount same-day activity but never overcount.
 */

export type VisitDeltas = {
  /** Day key (YYYY-MM-DD) of the previous visit. */
  sinceDay: string;
  reports: number;
  taps: number;
  newLeads: number;
  reobservations: number;
  hasAnything: boolean;
};

export function computeVisitDeltas(days: ActivityDay[], previousVisitIso: string, nowIso: string): VisitDeltas | null {
  const prevMs = new Date(previousVisitIso).getTime();
  if (!Number.isFinite(prevMs)) return null;
  const sinceDay = previousVisitIso.slice(0, 10);
  const today = nowIso.slice(0, 10);
  // A repeat visit on the same day has no completed day to report on.
  if (sinceDay >= today) return null;
  const totals = days
    .filter((day) => day.day > sinceDay)
    .reduce(
      (sum, day) => ({
        reports: sum.reports + day.reports,
        taps: sum.taps + day.taps,
        newLeads: sum.newLeads + day.newLeads,
        reobservations: sum.reobservations + day.reobservations,
      }),
      { reports: 0, taps: 0, newLeads: 0, reobservations: 0 },
    );
  return {
    sinceDay,
    ...totals,
    hasAnything: totals.reports + totals.taps + totals.newLeads + totals.reobservations > 0,
  };
}
