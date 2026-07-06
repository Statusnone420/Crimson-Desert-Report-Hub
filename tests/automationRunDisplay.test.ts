import { describe, expect, it } from "vitest";
import { formatEasternDateTime, summarizeRunMessages } from "@/lib/automation/runDisplay";

describe("source monitor run display", () => {
  it("formats persisted UTC run times as explicit Eastern time", () => {
    expect(formatEasternDateTime("2026-07-06T03:28:37.000Z")).toBe("Jul 5, 2026, 11:28:37 PM EDT");
  });

  it("groups raw skip codes into operator-readable summaries", () => {
    const summary = summarizeRunMessages(
      [
        "reddit_disabled",
        "source_not_issue_report",
        "source_not_issue_report",
        "openrouter_invalid_json",
        "openrouter_provider_failure",
        "wrong_patch",
        "llm_allowance_exhausted",
      ],
      [],
    );

    expect(summary.skipGroups).toEqual([
      expect.objectContaining({ code: "source_not_issue_report", count: 2, label: "Not issue reports" }),
      expect.objectContaining({ code: "reddit_disabled", count: 1, label: "Reddit disabled" }),
      expect.objectContaining({ code: "openrouter_invalid_json", count: 1, label: "OpenRouter invalid JSON" }),
      expect.objectContaining({ code: "openrouter_provider_failure", count: 1, label: "OpenRouter provider failure" }),
      expect.objectContaining({ code: "wrong_patch", count: 1, label: "Wrong patch" }),
      expect.objectContaining({ code: "llm_allowance_exhausted", count: 1, label: "LLM allowance exhausted" }),
    ]);
    expect(summary.operatorSummary).toBe(
      "2 not issue reports; 1 Reddit disabled; 1 OpenRouter invalid JSON; 1 OpenRouter provider failure; 1 wrong patch; 1 LLM allowance exhausted",
    );
    expect(summary.errorSummary).toBe("No errors");
  });

  it("labels a stood-down scheduled attempt as a recent scan already ran", () => {
    const summary = summarizeRunMessages(["recent_run"], []);

    expect(summary.skipGroups).toEqual([
      expect.objectContaining({ code: "recent_run", count: 1, label: "Recent scan already ran" }),
    ]);
  });

  it("labels a stood-down scheduled attempt as paused when scans are paused", () => {
    const summary = summarizeRunMessages(["paused"], []);

    expect(summary.skipGroups).toEqual([
      expect.objectContaining({ code: "paused", count: 1, label: "Scheduled scans paused" }),
    ]);
  });

  it("labels policy cap skip reasons in plain language", () => {
    const summary = summarizeRunMessages(["tavily_credit_cap", "llm_budget_capped"], []);

    expect(summary.skipGroups).toEqual([
      expect.objectContaining({ code: "tavily_credit_cap", count: 1, label: "Search credit cap reached" }),
      expect.objectContaining({ code: "llm_budget_capped", count: 1, label: "LLM cap reached" }),
    ]);
  });

  it("maps known error codes to plain-language labels in the error summary", () => {
    expect(summarizeRunMessages([], ["stale_running_run"]).errorSummary).toBe("Crashed run cleaned up");
  });

  it("leaves unrecognized error strings untouched alongside mapped codes", () => {
    expect(summarizeRunMessages([], ["stale_running_run", "reddit failed: timeout"]).errorSummary).toBe(
      "Crashed run cleaned up; reddit failed: timeout",
    );
  });
});
