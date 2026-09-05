import { reportSchema, type ReportInput } from "@/lib/reportSchema";

export type ReportPatchMetadata = {
  version: string;
  title: string;
  officialUrl: string;
};

export type ReportDraft = {
  patch_version: string;
  platform: string;
  category: string;
  severity: string;
  frequency: string;
  issue_title: string;
  description: string;
  repro_steps: string;
  expected_behavior: string;
  actual_behavior: string;
  location_quest: string;
  hardware_specs: string;
  graphics_mode: string;
  driver_os: string;
  troubleshooting_tried: string;
  pers_id: string;
  evidence_url: string;
  official_report_submitted: boolean;
};

export type ReportDraftErrors = Record<string, string>;

export function blankReportDraft(currentPatch: ReportPatchMetadata): ReportDraft {
  return {
    patch_version: currentPatch.version,
    platform: "",
    category: "",
    severity: "medium",
    frequency: "sometimes",
    issue_title: "",
    description: "",
    repro_steps: "",
    expected_behavior: "",
    actual_behavior: "",
    location_quest: "",
    hardware_specs: "",
    graphics_mode: "",
    driver_os: "",
    troubleshooting_tried: "",
    pers_id: "",
    evidence_url: "",
    official_report_submitted: false,
  };
}

export function validateReportDraft(draft: ReportDraft): { data: ReportInput | null; errors: ReportDraftErrors } {
  const parsed = reportSchema.safeParse(draft);
  if (parsed.success) return { data: parsed.data, errors: {} };
  return {
    data: null,
    errors: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])),
  };
}
