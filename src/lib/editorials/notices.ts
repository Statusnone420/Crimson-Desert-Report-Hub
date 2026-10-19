/** Short confirmations shown on the Column card after an action. */
export const COLUMN_NOTICES = {
  paused: "Column paused. Scheduled slots now record a skip and nothing is written.",
  resumed: "Column resumed. The next scheduled slot writes an edition; missed slots are not made up.",
  vetoed: "Edition vetoed. It's off the site and the feeds.",
  approved: "Edition approved and published.",
  not_pending: "That edition is no longer waiting for approval. Nothing changed.",
  not_vetoable: "That edition was already vetoed or skipped. Nothing changed.",
} as const;

export type ColumnNotice = keyof typeof COLUMN_NOTICES;

export function columnNotice(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(COLUMN_NOTICES, value) ? COLUMN_NOTICES[value as ColumnNotice] : null;
}
