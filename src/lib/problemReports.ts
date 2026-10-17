export const PROBLEM_REPORT_TYPES = ["broken_link", "outdated_info", "remove_content", "other"] as const;
export const PROBLEM_REPORT_STATUSES = ["new", "approved", "done", "dismissed"] as const;
export const PROBLEM_REPORT_LABELS: Record<(typeof PROBLEM_REPORT_TYPES)[number], string> = {
  broken_link: "Broken link",
  outdated_info: "Wrong or outdated info",
  remove_content: "Remove my content (creators)",
  other: "Other",
};
export const PROBLEM_REPORT_MAX_LENGTH = 2000;

export type ProblemReportStatus = (typeof PROBLEM_REPORT_STATUSES)[number];
export type ProblemReport = {
  id: string;
  created_at: string;
  updated_at: string;
  type: (typeof PROBLEM_REPORT_TYPES)[number];
  description: string;
  page_url: string;
  email: string | null;
  status: ProblemReportStatus;
  revision: number;
  private_notes: { text: string; created_at: string }[];
};
