import { describe, expect, it } from "vitest";
import { compareClusterRecency, createClusterRetriever, retrievalTokens } from "@/lib/automation/clusterRetrieval";

const cluster = (slug: string, title: string, extra: Partial<{ description: string; category: string; last_signal_at: string }> = {}) => ({
  slug,
  title,
  category: extra.category ?? "other",
  description: extra.description ?? null,
  last_signal_at: extra.last_signal_at ?? null,
  created_at: "2026-07-01T00:00:00.000Z",
});

describe("retrievalTokens", () => {
  it("folds word endings and accents so variants of one word meet", () => {
    expect(retrievalTokens("Crashes crashing crashed crash")).toEqual(["crash"]);
    expect(retrievalTokens("freeze freezes freezing")).toEqual(["freez"]);
    expect(retrievalTokens("Créchard tower")).toEqual(retrievalTokens("Crechard towers"));
  });

  it("drops filler, the game's name, generic issue words and bare numbers", () => {
    expect(retrievalTokens("Crimson Desert game bug: the issue after patch 2.03 on Steam")).toEqual([]);
    expect(retrievalTokens("Inventory crash 4K")).toEqual(["inventory", "crash"]);
  });
});

describe("createClusterRetriever", () => {
  const clusters = [
    cluster("auto-inventory", "Crash when opening the inventory", { category: "crash_startup" }),
    cluster("auto-map-crash", "Crash when opening the map", { category: "crash_startup", last_signal_at: "2026-10-01T00:00:00.000Z" }),
    cluster("auto-lyselia", "Lyselia dialogue softlock", { description: "Stuck after the fourth sanctuary.", last_signal_at: "2026-06-01T00:00:00.000Z" }),
    cluster("auto-audio", "Voice lines missing in cutscenes", { category: "audio" }),
  ];

  it("ranks clusters that share rarer words above ones that share common words", () => {
    const retrieve = createClusterRetriever(clusters, 8);
    expect(retrieve("Game crashes every time I open my inventory").map((item) => item.slug)).toEqual(["auto-inventory", "auto-map-crash"]);
    expect(retrieve("Softlocked in Lyselia's dialogue")[0].slug).toBe("auto-lyselia");
  });

  it("proposes nothing without a shared word and respects the limit", () => {
    expect(createClusterRetriever(clusters, 8)("Stutter in the market town")).toEqual([]);
    expect(createClusterRetriever(clusters, 1)("crash when opening things")).toHaveLength(1);
    expect(createClusterRetriever(clusters, 0)("inventory crash")).toEqual([]);
  });

  it("breaks score ties by recency, then slug, so the same input gives the same list", () => {
    const tied = [
      cluster("auto-b", "Horse vanishes", { last_signal_at: "2026-09-01T00:00:00.000Z" }),
      cluster("auto-a", "Horse vanishes"),
      cluster("auto-c", "Horse vanishes", { last_signal_at: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(createClusterRetriever(tied, 8)("my horse vanishes").map((item) => item.slug)).toEqual(["auto-c", "auto-b", "auto-a"]);
    expect([...tied].sort(compareClusterRecency).map((item) => item.slug)).toEqual(["auto-c", "auto-b", "auto-a"]);
  });
});
