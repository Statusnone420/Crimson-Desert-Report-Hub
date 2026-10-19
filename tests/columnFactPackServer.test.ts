import { describe, expect, it, vi } from "vitest";
import { editionLead } from "@/lib/editorials/factPack";
import { relevanceScore } from "@/lib/editorials/relevance";
import { history, NOTICE_URL } from "./columnPackFixtures";

vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: async () => ({ editions: [], articles: [], unavailable: true }) }));
vi.mock("@/lib/activityHistory.server", () => ({ getActivityHistory: async () => history() }));
vi.mock("@/lib/queries", () => ({ getIssuesData: async () => { throw new Error("board unavailable"); } }));

import { readFactPack } from "@/lib/editorials/factPack.server";

describe("reading the fact pack", () => {
  it("gives the Oct 26 edition the Hub's record of the Oct 29 launch, even when the other lanes can't be read", async () => {
    const pack = await readFactPack(new Date("2026-10-26T12:00:00Z"), null);
    const notices = pack.facts.filter((fact) => fact.id.startsWith("N"));
    expect(notices.map((fact) => fact.source.url)).toEqual([NOTICE_URL]);
    expect(notices[0].text).toBe("Pearl Abyss official notice published Sep 30, 10:20 UTC."
      + " Pearl Abyss moves the Charting the Unknown release by 2 weeks, to October 29."
      + " Pearl Abyss says it needs more development time to deliver a more polished and stable gameplay experience."
      + " The notice sets the release for Oct 29, 22:00 UTC.");
    expect(pack.deltas.upcomingReleaseIds).toEqual(["charting-the-unknown"]);
    expect(relevanceScore(pack.deltas)).toBe(2);
    expect(editionLead(pack)).toBe("notice");
    expect(pack.gaps).toEqual(expect.arrayContaining(["patches_unavailable", "issues_unavailable"]));
  });
});
