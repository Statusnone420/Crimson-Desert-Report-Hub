import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportForm } from "@/app/report/ReportForm";

const currentPatch = {
  version: "2.02.00",
  title: "Patch 2.02.00",
  officialUrl: "https://example.com/patch",
  source: "official" as const,
};

describe("report form issue context", () => {
  it("shows the public issue and selects its trusted category without changing the report payload", () => {
    const markup = renderToStaticMarkup(createElement(ReportForm, {
      currentPatch,
      patchVersions: ["2.02.00", "other"],
      issueContext: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        title: "Map freezes during combat",
        category: "controls_gameplay",
      },
    }));

    expect(markup).toContain("Starting from “Map freezes during combat”");
    expect(markup).toContain("Describe what happened on your setup.");
    expect(markup).toMatch(/<input[^>]*name="category"[^>]*checked=""[^>]*value="controls_gameplay"/);
    expect(markup).not.toContain("123e4567-e89b-42d3-a456-426614174000");
  });

  it("keeps the ordinary blank category when no issue context is present", () => {
    const markup = renderToStaticMarkup(createElement(ReportForm, {
      currentPatch,
      patchVersions: ["2.02.00", "other"],
    }));

    expect(markup).not.toContain("Starting from");
    expect(markup).not.toMatch(/name="category"[^>]*checked=""/);
  });
});
