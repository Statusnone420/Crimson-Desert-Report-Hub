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
  test_skipped: "The test draft was skipped. The reason is in the test draft list.",
  test_cap: "Ten test drafts already ran today (UTC). Try again tomorrow.",
  test_invalid: "Pick a writer and an effort. Nothing ran.",
  draft_published: "Test draft published as this week's edition. It's on the site and in the feeds now; Unpublish takes it down.",
  publish_confirm: "Tick the box to confirm you want this draft live. Nothing changed.",
  publish_no_slot: "This week's slot hasn't started yet, so there's nothing to publish it in place of. Nothing changed.",
  publish_slot_changed: "This week's slot changed since the page loaded. Reload and try again. Nothing changed.",
  publish_unavailable: "Publishing a test draft needs a database update that hasn't landed yet. Nothing changed.",
  publish_not_promotable: "Only a test draft that passed its fact check can be published. Nothing changed.",
  publish_not_approved: "Give the test draft a thumbs up first. Nothing changed.",
  publish_slot_taken: "This week's slot already has an edition. Nothing changed.",
} as const;

export type ColumnNotice = keyof typeof COLUMN_NOTICES;

export function columnNotice(value: unknown): string | null {
  return typeof value === "string" && Object.hasOwn(COLUMN_NOTICES, value) ? COLUMN_NOTICES[value as ColumnNotice] : null;
}

/** Why a slot skipped, in the operator's words. */
const SKIP_REASON_LABELS: Record<string, string> = {
  paused: "Paused",
  below_threshold: "Not enough news",
  min_gap: "Too soon after the last edition",
  budget: "Over the column budget",
  prompt_too_large: "Prompt too large",
  provider_unavailable: "Provider unavailable",
  model_not_allowed: "Model not allowed",
  writer_failed: "Writer failed",
  check_failed: "Fact check failed",
  person_named: "Named a person",
  too_short: "Too short after fact check",
  missing_required_section: "Missing the patch notes and corroboration sections",
  slop_check_failed: "Failed the style check",
  no_time: "No time left after the scan",
  too_long: "Too long for the page",
};

/** A check_failed skip whose checker never judged the draft says what stopped it instead. */
const UNJUDGED_CHECK_LABELS: Record<string, string> = {
  max_tokens: "Checker hit its token limit",
  checker_out_of_time: "No time left for the fact check",
};

/** The label for a skip, from its reason and the note in its check report. */
export function skipReasonLabel(reason: string | null, note: string | null): string {
  if (reason === "check_failed" && note !== null && Object.hasOwn(UNJUDGED_CHECK_LABELS, note)) return UNJUDGED_CHECK_LABELS[note];
  return reason !== null && Object.hasOwn(SKIP_REASON_LABELS, reason) ? SKIP_REASON_LABELS[reason] : reason ?? "no reason recorded";
}
