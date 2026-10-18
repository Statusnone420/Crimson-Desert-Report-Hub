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

  it("keeps titles apart when their numbers differ, but not their versions", () => {
    const save = [{ id: "7", slug: "auto-save", title: "Error 15 when loading a save", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Error 30 when loading a save", "crash_startup", save)).toBeNull();
    expect(nearDuplicateAutoCluster("Error when loading a save", "crash_startup", save)).toBeNull();
    expect(nearDuplicateAutoCluster("Error 15 while loading a save", "crash_startup", save)?.id).toBe("7");
    expect(nearDuplicateAutoCluster("Crash after 1.04 when opening the map", "crash_startup", clusters)?.id).toBe("1");
    expect(nearDuplicateAutoCluster("Crash after v2.03.02 when opening the map", "crash_startup", clusters)?.id).toBe("1");
  });

  it("keeps titles apart when a short term differs, but not its short filler", () => {
    const stutter = [{ id: "8", slug: "auto-ui", title: "UI stutter during combat", category: "performance" }];
    expect(nearDuplicateAutoCluster("AI stutter during combat", "performance", stutter)).toBeNull();
    expect(nearDuplicateAutoCluster("UI stutters during combat", "performance", stutter)?.id).toBe("8");
    const fps = [{ id: "9", slug: "auto-4k", title: "FPS drops at 4K", category: "performance" }];
    expect(nearDuplicateAutoCluster("FPS drops in 4K", "performance", fps)?.id).toBe("9");
    expect(nearDuplicateAutoCluster("FPS drops in 8K", "performance", fps)).toBeNull();
  });

  it("keeps titles apart when a word is swapped for another, but joins one that adds a word", () => {
    const screens = [{ id: "12", slug: "auto-map-screen", title: "Crash when opening the map screen", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Crash when opening the inventory screen", "crash_startup", screens)).toBeNull();
    expect(nearDuplicateAutoCluster("Crash when opening the map", "crash_startup", screens)?.id).toBe("12");
  });

  it("keeps titles apart when a pair of opposites is swapped", () => {
    const subtitles = [{ id: "13", slug: "auto-subtitles-on", title: "Subtitles keep turning on by themselves", category: "other" }];
    expect(nearDuplicateAutoCluster("Subtitles keep turning off by themselves", "other", subtitles)).toBeNull();
    expect(nearDuplicateAutoCluster("Subtitles keep turning on by themselves in menus", "other", subtitles)?.id).toBe("13");
    const boss = [{ id: "14", slug: "auto-boss", title: "Game crashes after the final boss cutscene", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Game crashes before the final boss cutscene", "crash_startup", boss)).toBeNull();
  });

  it("keeps titles apart when a direction is swapped", () => {
    const deposit = [{ id: "17", slug: "auto-storage-deposit", title: "Cannot transfer items to storage", category: "controls_gameplay" }];
    expect(nearDuplicateAutoCluster("Cannot transfer items from storage", "controls_gameplay", deposit)).toBeNull();
    expect(nearDuplicateAutoCluster("Can't transfer my items to storage", "controls_gameplay", deposit)?.id).toBe("17");
    const tower = [{ id: "18", slug: "auto-tower", title: "Can't climb into the castle tower", category: "controls_gameplay" }];
    expect(nearDuplicateAutoCluster("Can't climb out of the castle tower", "controls_gameplay", tower)).toBeNull();
    const saddle = [{ id: "19", slug: "auto-saddle", title: "Can't jump onto the horse saddle", category: "controls_gameplay" }];
    expect(nearDuplicateAutoCluster("Can't jump off the horse saddle", "controls_gameplay", saddle)).toBeNull();
    // A pair word only one title has changes nothing.
    const save = [{ id: "20", slug: "auto-save-cloud", title: "Failed to load a save", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Failed to load a save from the cloud", "crash_startup", save)?.id).toBe("20");
  });

  it("keeps titles apart when they name different moments, but joins words for the same moment", () => {
    const save = [{ id: "15", slug: "auto-save-load", title: "Crash after loading a save", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Crash while loading a save", "crash_startup", save)).toBeNull();
    expect(nearDuplicateAutoCluster("Crash before loading a save", "crash_startup", save)).toBeNull();
    expect(nearDuplicateAutoCluster("Crash since loading a save", "crash_startup", save)?.id).toBe("15");
    const during = [{ id: "16", slug: "auto-save-during", title: "Crash while loading a save", category: "crash_startup" }];
    expect(nearDuplicateAutoCluster("Crash when loading a save", "crash_startup", during)?.id).toBe("16");
  });

  it("keeps a title apart from its opposite", () => {
    const shadows = [{ id: "10", slug: "auto-shadows", title: "Shadows appear indoors", category: "graphics_visual" }];
    expect(nearDuplicateAutoCluster("Shadows do not appear indoors", "graphics_visual", shadows)).toBeNull();
    expect(nearDuplicateAutoCluster("Shadows don’t appear indoors", "graphics_visual", shadows)).toBeNull();
    expect(nearDuplicateAutoCluster("Shadows never appear indoors", "graphics_visual", shadows)).toBeNull();
    expect(nearDuplicateAutoCluster("Shadows appearing indoors", "graphics_visual", shadows)?.id).toBe("10");
    const missing = [{ id: "11", slug: "auto-no-shadows", title: "Shadows do not appear indoors", category: "graphics_visual" }];
    expect(nearDuplicateAutoCluster("Shadows never appear indoors", "graphics_visual", missing)?.id).toBe("11");
  });

  it("skips an emptied automatic group but keeps one created earlier in the batch", () => {
    const emptied = { id: "5", slug: "auto-emptied", title: "Crash when opening map", category: "crash_startup", signal_count: 0 };
    expect(nearDuplicateAutoCluster("Game crashes when opening the map", "crash_startup", [emptied])).toBeNull();
    const createdThisBatch = { id: "6", slug: "auto-new", title: "Crash when opening map", category: "crash_startup" };
    expect(nearDuplicateAutoCluster("Game crashes when opening the map", "crash_startup", [emptied, createdThisBatch])?.id).toBe("6");
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
