import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ProblemReportButton } from "@/components/ProblemReportButton";

afterEach(() => vi.unstubAllEnvs());

it("offers the report button only once its Turnstile widget is configured", () => {
  vi.stubEnv("NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY", "");
  expect(renderToStaticMarkup(createElement(ProblemReportButton))).toBe("");
  vi.stubEnv("NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY", "fixture-site-key");
  expect(renderToStaticMarkup(createElement(ProblemReportButton))).toContain(">Report a problem</button>");
});
