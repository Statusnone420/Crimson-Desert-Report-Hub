import { describe, expect, it, vi } from "vitest";
import { editionLead } from "@/lib/editorials/factPack";
import { relevanceScore } from "@/lib/editorials/relevance";
import { CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { history } from "./columnPackFixtures";

vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: async () => ({ editions: [], articles: [], unavailable: true }) }));
vi.mock("@/lib/activityHistory.server", () => ({ getActivityHistory: async () => history() }));
vi.mock("@/lib/queries", () => ({ getIssuesData: async () => { throw new Error("board unavailable"); } }));

import { readFactPack } from "@/lib/editorials/factPack.server";

describe("reading the fact pack", () => {
  it("gives the Oct 26 edition the Hub's record of the Oct 29 launch, even when the other lanes can't be read", async () => {
    const pack = await readFactPack(new Date("2026-10-26T12:00:00Z"), null);
    // The Oct 20 features overview sets the same time as the Sep 30 delay notice, so it replaces it.
    // The Oct 8 short is on YouTube, not an official notice page, so it stays out.
    const features = CATCH_UP_MILESTONES.find((item) => item.id === "charting-the-unknown-features")!;
    const notices = pack.facts.filter((fact) => fact.id.startsWith("N"));
    expect(notices.map((fact) => fact.source.url)).toEqual(["https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=137"]);
    expect(notices[0].text).toBe(`Pearl Abyss official notice published Oct 20, 23:00 UTC. ${features.noticeSays!.join(" ")}`
      + " The notice sets the release for Oct 29, 22:00 UTC.");
    expect(notices[0].text).toContain("Diving needs no special conditions.");
    expect(pack.deltas.upcomingReleaseIds).toEqual(["charting-the-unknown"]);
    // New in the last 7 days (+2) and a release within 14 days (+2), capped at 3 together.
    expect(pack.deltas.newNoticeIds).toEqual(["charting-the-unknown-features"]);
    expect(relevanceScore(pack.deltas)).toBe(3);
    expect(editionLead(pack)).toBe("notice");
    expect(pack.gaps).toEqual(expect.arrayContaining(["patches_unavailable", "issues_unavailable"]));
  });
});
