import { describe, expect, it } from "vitest";
import { blankReportDraft, validateReportDraft } from "@/lib/reportDraft";

const valid = {
  ...blankReportDraft({ version: "2.01.00", title: "Patch 2.01.00", officialUrl: "https://example.com/patch" }),
  platform: "pc_steam",
  category: "controls_gameplay",
  severity: "medium",
  frequency: "always",
  issue_title: "Opening the map freezes the game",
  description: "The game freezes when I open the map while in combat near the camp.",
};

describe("report draft review contract", () => {
  it("uses the application schema and preserves an explicit false checkbox", () => {
    const result = validateReportDraft({ ...valid, issue_title: "  " + valid.issue_title + "  " });

    expect(result.errors).toEqual({});
    expect(result.data?.issue_title).toBe(valid.issue_title);
    expect(result.data?.official_report_submitted).toBe(false);
    expect(result.data?.hardware_specs).toBeNull();
  });

  it("rejects unsupported options, vague short text, and executable evidence URLs", () => {
    const result = validateReportDraft({
      ...valid,
      platform: "invented",
      description: "bug",
      evidence_url: "javascript:alert(1)",
    });

    expect(result.data).toBeNull();
    expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(["platform", "description", "evidence_url"]));
  });

  it("validates optional caps even when the corresponding form details are collapsed", () => {
    expect(validateReportDraft({ ...valid, hardware_specs: "x".repeat(501) }).errors).toHaveProperty("hardware_specs");
  });

  it("passes only the validated payload into the review and send stages", () => {
    const result = validateReportDraft({
      ...valid,
      untrusted_extra: "must not reach review",
      evidence_url: "https://example.com/evidence",
    } as typeof valid & { untrusted_extra: string });

    expect(result.data).toMatchObject({
      evidence_url: "https://example.com/evidence",
      official_report_submitted: false,
    });
    expect(result.data).not.toHaveProperty("untrusted_extra");
    expect(result.data?.hardware_specs).toBeNull();
  });
});
