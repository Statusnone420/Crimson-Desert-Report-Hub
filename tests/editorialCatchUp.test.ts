import { describe, expect, it } from "vitest";
import { buildCatchUpMilestones, CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { catchUpHash, parseCatchUpHash, selectCatchUpMilestones } from "@/lib/catchUp";
import { editorialArticles, chartingTheUnknownDelay, patch20300, type EditorialArticle } from "@/lib/editorialArticles";

describe("published patch reports and Catch Up", () => {
  it("includes the delay as an announcement for returning readers without changing official chronology", () => {
    const delay = CATCH_UP_MILESTONES.find((item) => item.id === "announcement-charting-the-unknown-delay")!;
    expect(delay.kind).toBe("announcement");
    expect(delay).not.toHaveProperty("patch");
    expect(delay.publishedAt).toBe("2026-09-30T10:20:00Z");
    expect(delay.availableAt).toBe(chartingTheUnknownDelay.publishedAt);
    expect(delay.source.url).toBe(chartingTheUnknownDelay.sources[0].url);
    expect(delay.related).toContainEqual({ label: "Read the report", url: chartingTheUnknownDelay.path });
    // The October expansion notices came after the delay, so every edition from Sep 30 lists them.
    const later = CATCH_UP_MILESTONES.filter((item) => Date.parse(item.publishedAt) > Date.parse(delay.publishedAt));
    expect(later.map((item) => item.id)).toEqual(["charting-the-unknown-diving-short", "charting-the-unknown-features"]);
    expect(selectCatchUpMilestones({ kind: "since", value: "2026-09-30T10:45:00Z" })).toEqual(later);
    expect(selectCatchUpMilestones({ kind: "since", value: "2026-09-30T10:45:00Z", remembered: true })).toEqual([delay, ...later]);
    expect(selectCatchUpMilestones({ kind: "since", value: "2026-09-30T13:00:00Z", remembered: true })).toEqual([delay, ...later]);
    expect(selectCatchUpMilestones({ kind: "highlights" })).toContain(delay);
    const original = CATCH_UP_MILESTONES.find((item) => item.id === "charting-the-unknown-announcement")!;
    expect(original.publishedAt).toBe("2026-09-03T14:00:00Z");
    expect(original.title).toContain("October 15");
  });

  it("keeps every timeline chapter unique and its chronology valid", () => {
    expect(new Set(CATCH_UP_MILESTONES.map((item) => item.id)).size).toBe(CATCH_UP_MILESTONES.length);
    const patches = CATCH_UP_MILESTONES.filter((item) => item.patch).map((item) => item.patch);
    expect(new Set(patches).size).toBe(patches.length);
    const dates = CATCH_UP_MILESTONES.map((item) => Date.parse(item.publishedAt));
    expect(dates.every(Number.isFinite)).toBe(true);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("includes each published patch report in the timeline with its official source and article link", () => {
    const patchReports = (editorialArticles as readonly EditorialArticle[]).filter((article) => article.patchVersion);
    expect(patchReports.length).toBeGreaterThan(0);

    for (const article of patchReports) {
      const version = article.patchVersion;
      const milestones = CATCH_UP_MILESTONES.filter((item) => item.patch === version);
      expect(milestones, `${article.path} must have one Catch Up entry`).toHaveLength(1);
      const milestone = milestones[0];
      expect(milestone.source.url).toBe(article.sources[0].url);
      expect(milestone.related?.some((link) => link.url === article.path)).toBe(true);
      expect(Date.parse(milestone.publishedAt)).toBeLessThanOrEqual(Date.parse(article.publishedAt));
      expect(Number.isFinite(Date.parse(milestone.availableAt ?? "")), `${article.path} needs its first Hub availability time`).toBe(true);
      expect(Date.parse(milestone.availableAt!)).toBeGreaterThanOrEqual(Date.parse(milestone.publishedAt));
      expect(milestone.summary.trim()).not.toBe("");
      expect(milestone.highlights.length).toBeGreaterThan(0);
      expect(milestone.highlights.every((highlight) => highlight.trim())).toBe(true);
      const selection = parseCatchUpHash(catchUpHash({ kind: "patch", value: version!, includeSelected: true }));
      expect(selectCatchUpMilestones(selection)[0]).toBe(milestone);
    }
  });

  it("automatically includes a newly registered report in recent, patch and remembered catch-ups", () => {
    const next: EditorialArticle = {
      ...patch20300,
      slug: "future-patch-fixture",
      path: "/articles/future-patch-fixture",
      patchVersion: "2.04.00",
      publishedAt: "2026-12-02T08:00:00Z",
      catchUp: {
        ...patch20300.catchUp,
        publishedAt: "2026-12-02T01:00:00Z",
        availableAt: "2026-12-02T08:00:00Z",
      },
    };
    const timeline = buildCatchUpMilestones([next, ...editorialArticles]);
    const added = timeline.at(-1)!;
    expect(timeline).toHaveLength(CATCH_UP_MILESTONES.length + 1);
    expect(added.patch).toBe("2.04.00");
    expect(added.related).toContainEqual({ label: "Read the Patch 2.04.00 report", url: next.path });
    expect(selectCatchUpMilestones({ kind: "highlights" }, timeline)).toContain(added);
    expect(selectCatchUpMilestones({ kind: "patch", value: "2.04.00", includeSelected: true }, timeline)).toEqual([added]);
    const after203 = CATCH_UP_MILESTONES.slice(CATCH_UP_MILESTONES.findIndex((item) => item.patch === "2.03.00") + 1);
    expect(selectCatchUpMilestones({ kind: "patch", value: "2.03.00" }, timeline)).toEqual([...after203, added]);
    const cursor = "2026-12-02T07:00:00Z";
    expect(selectCatchUpMilestones({ kind: "since", value: cursor }, timeline)).toEqual([]);
    expect(selectCatchUpMilestones({ kind: "since", value: cursor, remembered: true }, timeline)).toEqual([added]);
  });

  it("orders same-time hotfix reports by version even when the registry is newest first", () => {
    const hotfixes = ["2.04.02", "2.04.01"].map((patchVersion): EditorialArticle => ({
      ...patch20300,
      patchVersion,
      catchUp: { ...patch20300.catchUp, kind: "hotfix", publishedAt: "2026-12-02T01:00:00Z" },
    }));
    const timeline = buildCatchUpMilestones([...hotfixes, ...editorialArticles]);
    expect(selectCatchUpMilestones({ kind: "patch", value: "2.04.01", includeSelected: true }, timeline).map((item) => item.patch)).toEqual(["2.04.01", "2.04.02"]);
  });
});
