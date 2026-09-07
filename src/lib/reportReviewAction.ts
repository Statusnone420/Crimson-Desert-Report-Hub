export type ReportReviewActionState = {
  status: "idle" | "saved" | "error" | "stale" | "approved_excerpt_pending" | "transport_error";
  message: string | null;
  reportId: string | null;
};

export const INITIAL_REPORT_REVIEW_STATE: ReportReviewActionState = {
  status: "idle", message: null, reportId: null,
};
