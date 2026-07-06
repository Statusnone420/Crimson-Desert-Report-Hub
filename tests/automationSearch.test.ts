import { describe, expect, it, vi } from "vitest";
import { buildSearchQueries, tavilyExtract, tavilySearch } from "@/lib/automation/search";

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
      startDate: "2026-07-03",
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);

    expect(body).toStrictEqual({
      query: "Crimson Desert FPS",
      max_results: 5,
      search_depth: "basic",
      include_usage: true,
      start_date: "2026-07-03",
    });
    expect(body).not.toHaveProperty("auto_parameters");
    expect(body.search_depth).not.toBe("advanced");
  });
});

describe("Tavily extract request", () => {
  it("posts the url to the extract endpoint and returns trimmed raw_content", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            url: "https://reddit.com/r/CrimsonDesert/comments/thin/current_patch/",
            raw_content: "  constant stutter and fps drops on patch 1.13.00  ",
          },
        ],
      }),
    }));

    const raw = await tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/current_patch/", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
    });

    expect(raw).toBe("constant stutter and fps drops on patch 1.13.00");

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.tavily.com/extract");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer tavily-key",
    });
    expect(JSON.parse(init.body)).toStrictEqual({
      urls: ["https://reddit.com/r/CrimsonDesert/comments/thin/current_patch/"],
    });
  });

  it("returns null when no Tavily API key is configured", async () => {
    const fetcher = vi.fn();

    const raw = await tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
      env: {},
      fetcher,
    });

    expect(raw).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when the extract response has no usable results", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    const raw = await tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
    });

    expect(raw).toBeNull();
  });

  it("throws when the extract request fails", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));

    await expect(
      tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
      }),
    ).rejects.toThrow("tavily extract failed: 429");
  });
});
