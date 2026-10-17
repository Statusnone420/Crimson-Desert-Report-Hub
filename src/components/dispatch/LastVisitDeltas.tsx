"use client";

import { useSyncExternalStore } from "react";
import type { ActivityDay } from "@/lib/activitySeries";
import { computeVisitDeltas } from "@/lib/visitDeltas";

/**
 * The Brief remembers when this browser last opened it and says what moved
 * since — out loud, so the personalization is never silent. The timestamp
 * lives ONLY in this browser's localStorage (documented in docs/PRIVACY.md);
 * nothing is sent to the server and the aggregates shown are the same public
 * numbers every visitor gets. Renders nothing on a first visit, a same-day
 * return, or when storage is unavailable.
 */

const STORAGE_KEY = "cdReportHub.lastVisitAt";

/**
 * Read-and-advance the visit marker exactly once per page load, latched at
 * module scope so the external-store snapshot stays stable across renders
 * (the repo's useSyncExternalStore pattern — no setState inside an effect).
 */
let latchedPreviousVisit: string | null | undefined;

function previousVisitSnapshot(): string | null {
  if (latchedPreviousVisit === undefined) {
    try {
      const previous = window.localStorage.getItem(STORAGE_KEY);
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      latchedPreviousVisit = previous;
    } catch {
      // Storage unavailable (private mode, blocked): the note simply never appears.
      latchedPreviousVisit = null;
    }
  }
  return latchedPreviousVisit;
}

const subscribeNever = () => () => {};

function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

export function LastVisitDeltas({ days }: { days: ActivityDay[] }) {
  // Server snapshot is null, so the server renders nothing and the client
  // fills the note in after hydration without a mismatch.
  const previous = useSyncExternalStore(subscribeNever, previousVisitSnapshot, () => null);
  if (!previous) return null;

  const deltas = computeVisitDeltas(days, previous, new Date().toISOString());
  if (!deltas) return null;

  const parts: string[] = [];
  if (deltas.reports > 0) parts.push(`+${deltas.reports} report${deltas.reports === 1 ? "" : "s"}`);
  if (deltas.taps > 0) parts.push(`+${deltas.taps} tap${deltas.taps === 1 ? "" : "s"}`);
  if (deltas.newLeads > 0) parts.push(`+${deltas.newLeads} new lead${deltas.newLeads === 1 ? "" : "s"}`);
  if (deltas.reobservations > 0) parts.push(`+${deltas.reobservations} re-obs`);

  return (
    <p className="visit-deltas">
      <span className="visit-deltas__key">Since your last visit ({shortDay(deltas.sinceDay)})</span>
      {" — "}
      {deltas.hasAnything ? parts.join(" · ") : "nothing new"}.{" "}
      <span className="visit-deltas__note">Remembered by this browser only.</span>
    </p>
  );
}
