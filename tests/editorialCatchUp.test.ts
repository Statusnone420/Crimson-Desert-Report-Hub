import { describe, expect, it } from "vitest";
import { CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { editorialArticles } from "@/lib/editorialArticles";

describe("published patch reports and Catch Up", () => {
  it("includes each published patch report in the timeline with its official source and article link", () => {
    const patchReports = editorialArticles.filter((article) => article.slug.startsWith("patch-"));
    expect(patchReports.length).toBeGreaterThan(0);

    for (const article of patchReports) {
      const version = article.slug.slice("patch-".length).replaceAll("-", ".");
      const milestones = CATCH_UP_MILESTONES.filter((item) => item.patch === version);
      expect(milestones, `${article.path} must have one Catch Up entry`).toHaveLength(1);
      const milestone = milestones[0];
      expect(milestone.source.url).toBe(article.sources[0].url);
      expect(milestone.related?.some((link) => link.url === article.path)).toBe(true);
      expect(Date.parse(milestone.publishedAt)).toBeLessThanOrEqual(Date.parse(article.publishedAt));
      expect(Number.isFinite(Date.parse(milestone.availableAt ?? "")), `${article.path} needs its first Hub availability time`).toBe(true);
      expect(Date.parse(milestone.availableAt!)).toBeGreaterThanOrEqual(Date.parse(milestone.publishedAt));
    }
  });
});
