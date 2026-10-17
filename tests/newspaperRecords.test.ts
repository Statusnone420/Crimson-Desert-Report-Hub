import { describe, expect, it } from "vitest";
import { buildClaimGroups, filterClaimGroups, type PublicClaim } from "@/components/newspaper/ClaimsRecord";
import { filterBoardEntries, type IssueBoardEntry } from "@/components/newspaper/IssueBoard";

const issue = (overrides: Partial<IssueBoardEntry> = {}): IssueBoardEntry => ({
  id: "issue-1",
  title: "Map crash after loading",
  category: "crash_startup",
  categoryLabel: "Crashes and startup",
  description: null,
  status: "Player-reported",
  tone: "crimson",
  sentence: "1 player report on this patch.",
  directReportCount: 1,
  signalCount: 0,
  candidateSignalCount: 0,
  confirmationCount: 0,
  reportPlatforms: [],
  platformCounts: [],
  excerpts: [],
  sourceLeadCount: 0,
  sourceLeads: [],
  ask: null,
  poll: null,
  confirmationCounts: {},
  storageScope: "1.13",
  ...overrides,
});

describe("newspaper board filtering", () => {
  it("matches the public title and category label, without using hidden fields", () => {
    const entries = [issue(), issue({ id: "issue-2", title: "Frame rate regression", category: "performance", categoryLabel: "Performance" })];
    expect(filterBoardEntries(entries, "startup", "all").map((entry) => entry.id)).toEqual(["issue-1"]);
    expect(filterBoardEntries(entries, "", "performance").map((entry) => entry.id)).toEqual(["issue-2"]);
    expect(filterBoardEntries(entries, "player report", "all")).toEqual([]);
  });
});

describe("official claim grouping", () => {
  const claims: PublicClaim[] = [
    { fixText: "Fixed the first content issue.", category: "quest_progression", section: "Content" },
    { fixText: "Fixed the second content issue.", category: "quest_progression", section: "Content" },
    { fixText: "Fixed the combat issue.", category: "controls_gameplay", section: "Combat" },
  ];

  it("keeps source section order and consecutive source sections together", () => {
    const groups = buildClaimGroups(claims);
    expect(groups.map((group) => [group.label, group.claims.length])).toEqual([["Content", 2], ["Combat", 1]]);
    expect(groups.map((group) => group.visual)).toEqual(["content", "combat"]);
  });

  it("uses the approved combat art for an official Combat / Action heading without changing the heading", () => {
    const [group] = buildClaimGroups([{ fixText: "Fixed an action issue.", category: null, section: "Combat / Action" }]);
    expect(group.label).toBe("Combat / Action");
    expect(group.visual).toBe("combat");
  });

  it("keeps legacy rows under a neutral record heading", () => {
    expect(buildClaimGroups([{ fixText: "Fixed a legacy row.", category: null, section: null }])).toEqual([
      { key: "", label: "Official claims", visual: "other", claims: [{ fixText: "Fixed a legacy row.", category: null, section: null }] },
    ]);
  });

  it("filters verbatim claims without changing their source grouping", () => {
    const groups = filterClaimGroups(buildClaimGroups(claims), "combat", "all");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Combat");
    expect(groups[0].claims[0].fixText).toBe("Fixed the combat issue.");
  });
});
