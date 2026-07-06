import { describe, expect, it, vi } from "vitest";
import { buildSearchQueries, tavilySearch } from "@/lib/automation/search";

describe("automation search planning", () => {
  it("keeps the default first queries compatible with existing low query budgets", () => {
    expect(buildSearchQueries(2, "1.14.00")).toEqual([
      "Crimson Desert patch 1.14.00 FPS drops stutter issue",
      "Crimson Desert patch 1.14.00 crash freeze issue",
    ]);
  });

  it("plans focused Reddit, Steam, crash, performance, platform, and patch queries", () => {
    const queries = buildSearchQueries(999, "1.14.00");
    const combined = queries.join(" ");

    expect(queries).toHaveLength(6);
    expect(combined).toContain("reddit.com");
    expect(combined).toContain("steamcommunity.com");
    expect(combined).toMatch(/crash.*freeze|freeze.*crash/i);
    expect(combined).toMatch(/FPS|performance/i);
    expect(combined).toContain("PS5");
    expect(combined).toContain("PC");
    expect(combined).toContain("latest patch 1.14.00");
  });

  it("rotates focused query themes by offset and wraps around the pack", () => {
    expect(buildSearchQueries(3, "1.14.00", { rotationOffset: 4 })).toEqual([
      "Crimson Desert PS5 PC performance drops patch 1.14.00",
      "Crimson Desert latest patch 1.14.00 known issue hotfix",
      "Crimson Desert patch 1.14.00 FPS drops stutter issue",
    ]);
  });
});

describe("Tavily search request", () => {
  it("uses basic search with usage included and no automatic advanced parameters", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    await tavilySearch("Crimson Desert FPS", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
      now: new Date("2026-07-05T12:00:00Z"),
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);

    expect(body).toStrictEqual({
      query: "Crimson Desert FPS",
      max_results: 5,
      search_depth: "basic",
      include_usage: true,
    });
    expect(body).not.toHaveProperty("auto_parameters");
    expect(body.search_depth).not.toBe("advanced");
  });
});
