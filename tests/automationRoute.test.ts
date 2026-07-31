import { describe, expect, it } from "vitest";
import { routeToWatchlistCluster, type RoutableCluster } from "@/lib/automation/route";

const clusters: RoutableCluster[] = [
  { id: "cluster-perf", slug: "performance_regression", title: "Performance regression", category: "performance" },
  { id: "cluster-crash", slug: "crash_startup_hang", title: "Crash / startup hang", category: "crash_startup" },
  { id: "cluster-map", slug: "map_open_crash_persistent", title: "Map-open crash", category: "crash_startup" },
  { id: "cluster-boss", slug: "boss_rematch_crash_persistent", title: "Boss rematch crash", category: "crash_startup" },
  { id: "cluster-controls", slug: "controls_input_gameplay", title: "Controls / input gameplay", category: "controls_gameplay" },
  { id: "cluster-hardware", slug: "hardware_driver_specific", title: "Hardware / driver specific", category: "performance" },
];

describe("routeToWatchlistCluster", () => {
  it("rejects a cross-category LLM slug and falls back to same-category keywords", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "FPS drops hard",
        summary: "stutter city",
        category: "performance",
        llmClusterAssignment: "sure",
        llmClusterSlug: "boss_rematch_crash_persistent",
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "performance_regression"));
  });

  it("routes map-open crash language to map_open_crash_persistent when there is no LLM slug", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "game crashes when I open the map",
        summary: "",
        category: "crash_startup",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "map_open_crash_persistent"));
  });

  it("converges a differently worded signal into a parser-validated active auto-cluster", () => {
    const autoCluster: RoutableCluster = {
      id: "cluster-auto-hitch",
      slug: "auto-hitching-between-areas",
      title: "Hitching between areas",
      category: "performance",
    };

    const result = routeToWatchlistCluster(
      {
        issueTitle: "The game pauses for a second whenever I cross into a new zone",
        summary: "The slowdown occurs at area boundaries.",
        category: "performance",
        llmClusterAssignment: "sure",
        llmClusterSlug: autoCluster.slug,
      },
      [...clusters, autoCluster],
    );

    expect(result).toEqual(autoCluster);
  });

  it("refuses an unsure auto-cluster proposal before deterministic keyword routing", () => {
    const autoCluster: RoutableCluster = {
      id: "cluster-auto-hitch",
      slug: "auto-hitching-between-areas",
      title: "Hitching between areas",
      category: "performance",
    };

    const result = routeToWatchlistCluster(
      {
        issueTitle: "The game pauses for a second whenever I cross into a new zone",
        summary: "The slowdown occurs at area boundaries.",
        category: "performance",
        llmClusterAssignment: "unsure",
        llmClusterSlug: autoCluster.slug,
      },
      [...clusters, autoCluster],
    );

    expect(result).toBeNull();
  });

  it("routes boss rematch crash language to boss_rematch_crash_persistent", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "boss rematch crashed again",
        summary: "",
        category: "crash_startup",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "boss_rematch_crash_persistent"));
  });

  it("routes fps drop language to performance_regression", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "fps drops since patch",
        summary: "",
        category: "performance",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "performance_regression"));
  });

  it("routes GPU driver language to hardware_driver_specific ahead of the generic performance route", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "stutter on my RTX 4070 after driver update",
        summary: "",
        category: "performance",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "hardware_driver_specific"));
  });

  it("routes horse control language to controls_input_gameplay", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "horse controls unresponsive",
        summary: "",
        category: "controls_gameplay",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toEqual(clusters.find((cluster) => cluster.slug === "controls_input_gameplay"));
  });

  it("returns null when no keyword route matches the category", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "weird audio buzzing",
        summary: "",
        category: "audio",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toBeNull();
  });

  it("does not route to a cluster whose category does not match the signal's category", () => {
    const result = routeToWatchlistCluster(
      {
        issueTitle: "map crash",
        summary: "",
        category: "performance",
        llmClusterSlug: null,
      },
      clusters,
    );
    expect(result).toBeNull();
  });
});
