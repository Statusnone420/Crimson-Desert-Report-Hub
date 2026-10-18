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
  note_saved: "Note saved. The writer reads the last ten notes.",
  note_invalid: "Pick a thumb or write a note of up to 500 characters. Nothing was saved.",
  example_saved: "Voice example saved.",
  example_invalid: "An example needs text, up to 1,500 characters, and a label of up to 80. Nothing was saved.",
  examples_full: "There are already five voice examples. Remove one first.",
  example_missing: "That voice example no longer exists. Nothing changed.",
  example_deleted: "Voice example removed.",
  example_moved: "Voice example moved.",
  examples_changed: "The examples changed in the meantime, so nothing moved. Try again.",
  test_saved: "Test draft saved. It's listed below and in the preview feed, never on the site.",
  test_skipped: "The test draft didn't pass. The reason is in the test draft list.",
  test_cap: "Ten test drafts already ran today (UTC). Try again tomorrow.",
  test_invalid: "Pick a writer and an effort. Nothing ran.",
} as const;

export type ColumnNotice = keyof typeof COLUMN_NOTICES;

export function columnNotice(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(COLUMN_NOTICES, value) ? COLUMN_NOTICES[value as ColumnNotice] : null;
}
