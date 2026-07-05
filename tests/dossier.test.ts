import { describe, expect, it } from "vitest";
import { buildDeterministicDossier, type DossierInput } from "@/lib/dossier";

const input: DossierInput = {
  generatedAt: "2026-07-05T18:00:00Z",
  patchVersion: "1.13.00",
  totalApproved: 40,
  pendingCount: 6,
  byCategory: { performance: 25, crash_startup: 10, controls_gameplay: 5 },
  platforms: { ps5: 18, pc_steam: 15, ps5_pro: 7 },
  clusters: [
    { title: "Map-open crash", fixStatus: "persists", confidence: "confirmed", count: 8, topPlatform: "ps5" },
    { title: "FPS regression", fixStatus: "reported", confidence: "medium", count: 25, topPlatform: "pc_steam" },
    { title: "Airborne cancel", fixStatus: "reported", confidence: "seed_unverified", count: 0, topPlatform: null },
  ],
  reproNotes: [{ title: "Map-open crash", steps: "Open world map during mounted combat" }],
  evidenceUrls: ["https://www.reddit.com/r/CrimsonDesert/comments/abc/"],
};

describe("buildDeterministicDossier", () => {
  const md = buildDeterministicDossier(input);

  it("contains all seven required sections", () => {
    for (const h of [
      "## Executive summary",
      "## Top issues",
      "## Platform and hardware breakdown",
      "## Reproduction patterns",
      "## Evidence links",
      "## Known confidence gaps",
      "## Recommended wording for Pearl Abyss",
    ]) {
      expect(md).toContain(h);
    }
  });

  it("ranks issues by count descending", () => {
    expect(md.indexOf("FPS regression")).toBeLessThan(md.indexOf("Map-open crash"));
  });

  it("flags persists-after-fix issues and excludes zero-count unverified from top issues", () => {
    expect(md).toContain("persists after a claimed fix");
    const topSection = md.split("## Top issues")[1].split("## Platform")[0];
    expect(topSection).not.toContain("Airborne cancel");
  });

  it("lists unverified clusters in confidence gaps", () => {
    const gaps = md.split("## Known confidence gaps")[1];
    expect(gaps).toContain("Airborne cancel");
  });

  it("includes headline numbers", () => {
    expect(md).toContain("40 moderated community reports");
    expect(md).toContain("1.13.00");
  });
});
