import { describe, expect, it } from "vitest";
import { leadTitle } from "@/components/scanner/AdminScannerView";
import { nearDuplicateAutoCluster } from "@/lib/automation/clusterRetrieval";
import type { AdminSignalRow } from "@/lib/queries";

const clusters = [
  { id: "1", slug: "auto-map", title: "Crash when opening map", category: "crash_startup", last_signal_at: "2026-10-17T00:00:00Z" },
  { id: "2", slug: "auto-quest", title: "Shadows Cast Over the River quest bugged", category: "quests_progression" },
  { id: "3", slug: "auto-map-older", title: "Crash when opening the map", category: "crash_startup", last_signal_at: "2026-10-01T00:00:00Z" },
  { id: "4", slug: "map_open_crash_persistent", title: "Crash when opening the map", category: "crash_startup" },
];

describe("joining a reworded lead to its automatic issue group", () => {
  it.each([
    ["Game crashes when opening the map", "crash_startup", "1"],
    ["The 'Shadows Cast Over The River' quest is bugged", "quests_progression", "2"],
  ])("joins %s", (title, category, id) => {
    expect(nearDuplicateAutoCluster(title, category, clusters)?.id).toBe(id);
  });

  it.each([
    ["Crash when opening the inventory", "crash_startup"],
    ["Game crashes when opening the map", "performance"],
    ["Crashing", "crash_startup"],
    ["Shadows Cast Over the River cutscene does not play on PS5", "quests_progression"],
  ])("leaves %s (%s) apart", (title, category) => {
    expect(nearDuplicateAutoCluster(title, category, clusters)).toBeNull();
  });

  it("never picks a named watchlist cluster, and prefers the most recent of equal matches", () => {
    expect(nearDuplicateAutoCluster("Crash when opening map", "crash_startup", clusters)?.id).toBe("1");
    expect(nearDuplicateAutoCluster("Crash when opening map", "crash_startup", [clusters[3]])).toBeNull();
  });
});

describe("the private lead list title", () => {
  const row = (overrides: Partial<AdminSignalRow>) => ({
    source: "steam_review",
    title: "Crimson Desert player issue on Steam",
    extracted_facts: { issueTitle: "Crashes after the latest update" },
    ...overrides,
  }) as AdminSignalRow;

  it("shows the issue title written for each Steam review instead of the shared placeholder", () => {
    expect(leadTitle(row({}))).toBe("Crashes after the latest update");
  });

  it("keeps the source's own title for other sources and when no issue title was stored", () => {
    expect(leadTitle(row({ source: "web_search", title: "Thread title" }))).toBe("Thread title");
    expect(leadTitle(row({ extracted_facts: null }))).toBe("Crimson Desert player issue on Steam");
    expect(leadTitle(row({ extracted_facts: { issueTitle: "   " } }))).toBe("Crimson Desert player issue on Steam");
  });
});
