import type { ColumnBurst, ColumnSettings, RelevanceLevel, Weekday } from "@/lib/editorials/settings";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A slot is due from its time until six hours later. A slot missed in that window is not made up. */
export const DUE_WINDOW_MS = 6 * HOUR_MS;
/** The hourly wakes inside a window; the last one may record no_time instead of deferring again. */
export const LAST_WAKE_AFTER_MS = 5 * HOUR_MS;
const WEEKDAY_BY_UTC_DAY: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type ColumnSlot = {
  key: string;
  at: Date;
  burst: ColumnBurst | null;
  holdHours: number;
  relevance: RelevanceLevel;
};

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** ISO 8601 week, like 2026-W44: weeks start on Monday and week 1 holds the year's first Thursday. */
export function isoWeek(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  const thursday = new Date(day.getTime() + (3 - weekday) * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The enabled burst that covers a UTC date, inclusive at both ends. The first in the list wins. */
export function activeBurst(settings: ColumnSettings, date: string): ColumnBurst | null {
  return settings.bursts.find((burst) => burst.enabled && burst.startDate <= date && date <= burst.endDate) ?? null;
}

/** The slot a UTC date schedules, if any. A burst day replaces the base schedule entirely. */
export function slotForDate(settings: ColumnSettings, date: string): ColumnSlot | null {
  const burst = activeBurst(settings, date);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (burst) {
    return {
      key: `burst:${burst.id}:${date}`,
      at: new Date(midnight + burst.hourUtc * HOUR_MS),
      burst,
      holdHours: burst.holdHours,
      relevance: burst.relevance ?? settings.relevance,
    };
  }
  const weekday = WEEKDAY_BY_UTC_DAY[new Date(midnight).getUTCDay()];
  if (!settings.days.includes(weekday)) return null;
  // Keyed by weekday, not its place in the list, so editing the days mid-week never
  // renames a written slot or hides a new one.
  return {
    key: `${isoWeek(date)}:${weekday}`,
    at: new Date(midnight + settings.hourUtc * HOUR_MS),
    burst: null,
    holdHours: settings.holdHours,
    relevance: settings.relevance,
  };
}

/** The slot due now: today's or yesterday's, when now falls inside its six-hour window. */
export function dueSlot(settings: ColumnSettings, now: Date): ColumnSlot | null {
  const candidates = [utcDate(now.getTime() - DAY_MS), utcDate(now.getTime())]
    .map((date) => slotForDate(settings, date))
    .filter((slot): slot is ColumnSlot => slot !== null)
    .filter((slot) => now.getTime() >= slot.at.getTime() && now.getTime() < slot.at.getTime() + DUE_WINDOW_MS);
  return candidates.at(-1) ?? null;
}

/** The next slot strictly after now, for the Column card. Looks two weeks ahead. */
export function nextSlot(settings: ColumnSettings, now: Date): ColumnSlot | null {
  for (let offset = 0; offset <= 14; offset++) {
    const slot = slotForDate(settings, utcDate(now.getTime() + offset * DAY_MS));
    if (slot && slot.at.getTime() > now.getTime()) return slot;
  }
  return null;
}
