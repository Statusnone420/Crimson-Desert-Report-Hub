/** Short confirmations shown on the Column card after an action. */
export const COLUMN_NOTICES = {
  paused: "Column paused. Scheduled slots now record a skip and nothing is written.",
  resumed: "Column resumed. The next scheduled slot writes an edition; missed slots are not made up.",
  vetoed: "Edition vetoed. It's off the site and the feeds.",
  approved: "Edition approved and published.",
  not_pending: "That edition is no longer waiting for approval. Nothing changed.",
  not_vetoable: "That edition was already vetoed or skipped. Nothing changed.",
  settings_saved: "Cadence saved. It applies from the next slot.",
  invalid_value: "One of the values is outside its allowed range. Nothing was saved.",
  days_mismatch: "Pick one day for weekly, two for 2x or three for 3x. Nothing was saved.",
  burst_saved: "Burst saved.",
  burst_deleted: "Burst deleted.",
  burst_missing: "That burst no longer exists. Nothing changed.",
} as const;

export type ColumnNotice = keyof typeof COLUMN_NOTICES;

export function columnNotice(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(COLUMN_NOTICES, value) ? COLUMN_NOTICES[value as ColumnNotice] : null;
}
