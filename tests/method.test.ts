import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const aboutSource = readFileSync(path.join(process.cwd(), "src", "app", "about", "page.tsx"), "utf8");
const chromeSource = readFileSync(
  path.join(process.cwd(), "src", "components", "dispatch", "Chrome.tsx"),
  "utf8",
);

/** Visible prose only: JSX text nodes, with tags and expressions removed. */
function proseLength(source: string): number {
  const body = source.slice(source.indexOf("return ("));
  return body
    .replace(/\{[^{}]*\}/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Method is the canonical reference the rest of the site points at. The phased
 * copy diet deletes inline explainers on the strength of these anchors, so an
 * anchor going missing must fail here rather than becoming a dead link later.
 */
describe("method reference", () => {
  const anchors = [
    "registers",
    "claim-clock",
    "radar",
    "freshness",
    "privacy",
    "quiet",
    "source",
    "official-support",
  ];

  it("renders an element for every settled anchor", () => {
    for (const anchor of anchors) {
      expect(aboutSource).toContain(`id="${anchor}"`);
    }
  });

  it("keeps the privacy anchor the site footer links to from every page", () => {
    expect(chromeSource).toContain("/about#privacy");
    expect(aboutSource).toContain('id="privacy"');
  });

  it("answers in the summary so a deep link reads while collapsed", () => {
    // Each collapsible row must carry a visible answer, not just a question.
    const rows = aboutSource.match(/className="method-row__ask"/g) ?? [];
    const answers = aboutSource.match(/className="method-row__say"/g) ?? [];
    expect(rows.length).toBe(answers.length);
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it("stays a short answer sheet, not a reference manual", () => {
    // The detail belongs in the public repo. This ceiling is the guardrail
    // that keeps the page from drifting back into an essay.
    expect(proseLength(aboutSource)).toBeLessThan(3600);
    expect(aboutSource).toMatch(/docs\/wiki\//);
  });

  it("starts the claim clock when this tracker records the official claim", () => {
    const claimClock = aboutSource.slice(
      aboutSource.indexOf('id="claim-clock"'),
      aboutSource.indexOf('id="radar"'),
    );

    expect(claimClock).toContain("When this tracker records an official fix claim, the clock starts.");
    expect(claimClock).not.toContain("the clock marks that moment");
  });

  it("does not overpromise moderation or certainty the code cannot back", () => {
    // Excerpts can be deterministic enum-derived summaries with no human in
    // the loop; a lead is never evidence; quiet is never a fix.
    expect(aboutSource).not.toMatch(/reviewed by a moderator before any excerpt/i);
    expect(aboutSource).not.toMatch(/verified by (?:our|the) team/i);
    expect(aboutSource).not.toMatch(/guarantee[sd]?\b/i);
    expect(aboutSource).toMatch(/never your raw words/i);
  });
});
