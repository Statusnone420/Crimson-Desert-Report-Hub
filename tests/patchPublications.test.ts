import { describe, expect, it } from "vitest";
import { buildCatchUpMilestones, CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { parseCatchUpChapter, parseCatchUpHash, selectCatchUpMilestones } from "@/lib/catchUp";
import { editorialArticles, chartingTheUnknownDelay, patch20300 } from "@/lib/editorialArticles";
import { buildAtomXml, buildRssXml } from "@/lib/editorialFeed";
import { comparePatchVersions, frontPagePublications, patchPublications, patchRundown, patchVersionFromSlug, RUNDOWN_FIX_LIMIT, type PatchEdition } from "@/lib/patchPublications";

export const hotfix: PatchEdition = {
  version: "2.03.01",
  officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=132",
  publishedAt: "2026-09-21T14:00:00.000Z",
  observedAt: "2026-09-21T16:00:24.203Z",
  totalClaimedFixes: 3,
  fixes: [
    { fixText: "Fixed an issue where lantern aiming would not function with the newly assigned input after customizing the lantern-aim input for controllers.", category: null, section: "Patch Details" },
    { fixText: "Fixed an issue where NPCs for Duo would not appear in Tommaso, making it impossible to play the Duo minigame.", category: null, section: "Patch Details" },
    { fixText: "Fixed an issue where the game would crash when interacting with NPCs in certain situations.", category: "crash_startup", section: "Patch Details" },
  ],
};

describe("automatic official patch publications", () => {
  it("lets a later patch take the lead again without duplicating the announcement", () => {
    const futurePatch = { ...hotfix, version: "2.04.00", publishedAt: "2026-10-02T01:00:00Z" };
    const frontPage = frontPagePublications(patchPublications([hotfix, futurePatch]));
    expect(frontPage[0].patchVersion).toBe("2.04.00");
    expect(frontPage[1]).toBe(chartingTheUnknownDelay);
    expect(new Set(frontPage.map((article) => article.path)).size).toBe(frontPage.length);
  });

  it("keeps the new announcement first, the latest hotfix next, and every manual story", () => {
    const articles = patchPublications([hotfix]);
    const frontPage = frontPagePublications(articles);
    expect(frontPage[0]).toBe(chartingTheUnknownDelay);
    expect(frontPage[1].path).toBe("/articles/patch-2-03-01");
    expect(frontPage.filter((article) => article.publicationKind !== "rundown")).toEqual(editorialArticles);
  });

  it("selects by version even if an older editorial has a newer publication date", () => {
    const manual = [{ ...patch20300, publishedAt: "2026-09-25T01:00:00Z" }];
    expect(frontPagePublications(patchPublications([hotfix], manual), manual)[0].patchVersion).toBe("2.03.01");
    expect(comparePatchVersions("2.10.00", "2.9.02")).toBeGreaterThan(0);
    expect(comparePatchVersions("2.03.01", "2.03.00")).toBeGreaterThan(0);
  });

  it("gives a manual editorial precedence only for its exact version", () => {
    const manual = { ...patch20300, patchVersion: hotfix.version, path: "/articles/hotfix-report" as const };
    const articles = patchPublications([hotfix, { ...hotfix, version: "2.04.00" }], [manual]);
    expect(articles.filter((item) => item.patchVersion === hotfix.version)).toEqual([manual]);
    expect(frontPagePublications(articles, [manual])[0].patchVersion).toBe("2.04.00");
  });

  it("uses exact official bullets, stable dates and no inferred platform availability", () => {
    const rundown = patchRundown(hotfix);
    expect(rundown.catchUp?.highlights).toEqual(hotfix.fixes.map((fix) => fix.fixText));
    expect(rundown.catchUp?.availableAt).toBe(hotfix.observedAt);
    expect(rundown.publishedAt).toBe(hotfix.publishedAt);
    expect(rundown.sources[0].url).toBe(hotfix.officialUrl);
    expect(JSON.stringify(rundown)).not.toMatch(/available now|all platforms|confirmed fixed/i);
    expect(patchRundown(hotfix)).toEqual(rundown);
  });

  it("bounds long rundowns and handles patches without extracted fix bullets", () => {
    const large = patchRundown({ ...hotfix, fixes: Array.from({ length: 30 }, (_, i) => ({ ...hotfix.fixes[0], fixText: `Official fixed issue ${i}` })), totalClaimedFixes: 86 });
    expect(large.catchUp?.highlights).toHaveLength(RUNDOWN_FIX_LIMIT);
    const noFixes = patchRundown({ ...hotfix, fixes: [], totalClaimedFixes: 0, publishedAt: null });
    expect(noFixes.path).toBe("/articles/patch-2-03-01");
    expect(noFixes.publishedAt).toBe(hotfix.observedAt);
    expect(noFixes.catchUp?.highlights[0]).toContain("complete notes");
  });

  it("adds the new patch to Catch up without replacing reviewed historical summaries", () => {
    const milestones = buildCatchUpMilestones(patchPublications([hotfix, { ...hotfix, version: "2.01.00" }]));
    expect(milestones.filter((item) => item.patch === hotfix.version)).toHaveLength(1);
    expect(milestones.find((item) => item.patch === "2.01.00")).toEqual(CATCH_UP_MILESTONES.find((item) => item.patch === "2.01.00"));
    const selection = parseCatchUpHash("#patch=2.03.01&include=1", new Date("2026-09-22"), milestones);
    expect(selection).toEqual({ kind: "patch", value: "2.03.01", includeSelected: true });
    expect(selectCatchUpMilestones(selection, milestones).map((item) => item.patch ?? item.id)).toEqual([
      "2.03.01", "announcement-charting-the-unknown-delay", "charting-the-unknown-diving-short", "charting-the-unknown-features",
    ]);
    expect(parseCatchUpChapter("#chapter=hotfix-2-03-01", milestones)).toBe("hotfix-2-03-01");
  });

  it("distributes the same canonical rundown to both feeds without duplicates", () => {
    for (const xml of [buildAtomXml(patchPublications([hotfix])), buildRssXml(patchPublications([hotfix]))]) {
      expect(xml).toContain("/articles/patch-2-03-01");
      expect(xml.indexOf("/articles/patch-2-03-01")).toBeLessThan(xml.indexOf("/articles/patch-2-03-00"));
      expect(xml).not.toContain("undefined");
    }
  });

  it.each(["archive", "..", "2-03-01junk", "2-03-01-04", "2.03.01", "<script>"])("rejects invalid version slugs: %s", (slug) => {
    expect(patchVersionFromSlug(slug)).toBeNull();
  });
});
