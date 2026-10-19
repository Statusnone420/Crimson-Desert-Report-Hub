import { describe, expect, it, vi } from "vitest";
import { history, NOTICE_URL } from "./columnPackFixtures";

vi.mock("@/lib/patchPublications.server", () => ({ getPatchPublications: async () => ({ editions: [], articles: [], unavailable: true }) }));
vi.mock("@/lib/activityHistory.server", () => ({ getActivityHistory: async () => history() }));
vi.mock("@/lib/queries", () => ({ getIssuesData: async () => { throw new Error("board unavailable"); } }));

import { readFactPack } from "@/lib/editorials/factPack.server";

describe("reading the fact pack", () => {
  it("brings in the official notices the Hub keeps, even when the other lanes can't be read", async () => {
    const pack = await readFactPack(new Date("2026-10-26T12:00:00Z"), null);
    expect(pack.facts.filter((fact) => fact.id.startsWith("N")).map((fact) => fact.source.url)).toEqual([NOTICE_URL]);
    expect(pack.deltas.upcomingReleaseIds).toEqual(["charting-the-unknown"]);
    expect(pack.gaps).toEqual(expect.arrayContaining(["patches_unavailable", "issues_unavailable"]));
  });
});
