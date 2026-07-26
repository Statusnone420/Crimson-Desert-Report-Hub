import { describe, expect, it, vi } from "vitest";
import { buildSearchQueries, buildWireNewsQuery, tavilyExtract, tavilySearch } from "@/lib/automation/search";

// The press outlets whose behaviour the bake-off measured. Kept here rather than
// imported so a future edit to the pack cannot quietly redefine what "press" means
// and pass this file by construction.
const PRESS_DOMAINS = [
  "pcgamer.com",
  "eurogamer.net",
  "dsogaming.com",
  "ign.com",
  "gamespot.com",
  "polygon.com",
  "pushsquare.com",
  "purexbox.com",
  "wccftech.com",
  "rockpapershotgun.com",
  "vg247.com",
  "tomshardware.com",
  "kotaku.com",
] as const;

describe("automation search planning", () => {
  it("spends its first two credits on the official notes and the Steam store", () => {
    expect(buildSearchQueries(2, "1.14.00")).toEqual([
      "site:pearlabyss.com Crimson Desert patch 1.14.00 notes known issues",
      "site:store.steampowered.com Crimson Desert patch 1.14.00 update",
    ]);
  });

  it("asks official, storefront, community and press instead of two community domains", () => {
    const queries = buildSearchQueries(999, "1.14.00");
    const combined = queries.join(" ");

    expect(queries).toHaveLength(8);
    expect(queries.some((q) => q.includes("site:pearlabyss.com"))).toBe(true);
    expect(queries.some((q) => q.includes("site:store.steampowered.com"))).toBe(true);
    expect(queries.some((q) => q.includes("site:reddit.com") && q.includes("r/CrimsonDesert"))).toBe(true);
    expect(queries.some((q) => q.includes("site:steamcommunity.com"))).toBe(true);
    // Press is the corroborating half of the pack: promotion needs two independent
    // registrable domains and Reddit can never be the second one.
    expect(queries.filter((q) => PRESS_DOMAINS.some((domain) => q.includes(domain)))).toHaveLength(3);
    expect(combined).toContain("patch 1.14.00");
  });

  it("never asks a press outlet on its own", () => {
    // Measured against the live API: a single-site press query that finds nothing does
    // not return nothing. Tavily drops the filter and returns that outlet's other
    // recent articles — `site:pcgamer.com Crimson Desert patch performance` came back
    // as Borderlands 4, Helldivers 2 and Oblivion mods. Off-topic results on a TRUSTED
    // domain are the expensive kind, because a trusted domain is what qualifies a
    // candidate for a paid recon fetch. Multi-site `site:A OR site:B` holds the filter.
    for (const query of buildSearchQueries(999, "1.14.00")) {
      const mentionsPress = PRESS_DOMAINS.some((domain) => query.includes(domain));
      if (!mentionsPress) continue;
      expect(query, `press query must list several outlets: ${query}`).toContain(" OR site:");
    }
  });

  it("anchors its open-web query in the game so it cannot match the word alone", () => {
    // Unanchored "Crimson Desert patch" matched a coffee brand, two dictionaries, the
    // Harvard Crimson store and the US Army Corps of Engineers in production.
    const openWeb = buildSearchQueries(999, "1.14.00").filter((query) => !query.includes("site:"));

    expect(openWeb.length).toBeGreaterThan(0);
    for (const query of openWeb) {
      expect(query).toContain("Pearl Abyss");
      expect(query).toContain("Crimson Desert");
    }
  });

  it("rotates focused query themes by offset and wraps around the pack", () => {
    const pack = buildSearchQueries(999, "1.14.00");

    expect(buildSearchQueries(3, "1.14.00", { rotationOffset: 4 })).toEqual([
      pack[4],
      pack[5],
      pack[6],
    ]);
    // Wrapping keeps every query reachable, so an empty press trio this turn is not a
    // permanent loss.
    expect(buildSearchQueries(2, "1.14.00", { rotationOffset: 7 })).toEqual([pack[7], pack[0]]);
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

  it("stays on general search (no news topic), accepting that published_date is usually absent", async () => {
    // Root cause of source_published_at being null on every retained signal:
    // Tavily only returns published_date under topic "news", and switching to
    // the news index would drop the Reddit/Steam community threads the scanner
    // depends on. This locks the deliberate trade-off: general search, no
    // fabricated dates, scanner timestamps stay scanner timestamps.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    await tavilySearch("Crimson Desert FPS", { env: { TAVILY_API_KEY: "tavily-key" }, fetcher });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).not.toHaveProperty("topic");
  });

  it("sends topic news only when the wire's press slot asks for it", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    await tavilySearch(buildWireNewsQuery(), {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
      topic: "news",
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.topic).toBe("news");
    expect(body.query).toContain("Crimson Desert");
  });

  it("keeps every patch version out of the wire's news query", () => {
    // Measured against the live news index: the versioned form returned five dated
    // articles about Path of Exile and 007 First Light, because a version string
    // that appears in no headline leaves the index matching the generic words
    // around it. Without it, the same slot returned DSOGaming's "Crimson Desert
    // Patch 1.15.00 Released & Detailed", dated, which the pre-screen routes to
    // patch_release. A version is what breaks this query, so pin its absence.
    const query = buildWireNewsQuery();

    expect(query).not.toMatch(/\d+\.\d+/);
    expect(query).toContain("Crimson Desert");
    expect(query).toContain("Pearl Abyss");
  });

  it("preserves published_date as sourcePublishedAt whenever Tavily does supply one", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Patch 1.14.00 performance thread",
            url: "https://www.reddit.com/r/CrimsonDesert/comments/abc/",
            content: "fps drops after 1.14.00",
            published_date: "2026-07-17T08:00:00Z",
          },
          {
            title: "Undated general result",
            url: "https://steamcommunity.com/app/discussions/1",
            content: "stutter report",
          },
        ],
      }),
    }));

    const results = await tavilySearch("Crimson Desert FPS", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
      now: new Date("2026-07-19T12:00:00Z"),
    });

    expect(results[0].sourcePublishedAt).toBe("2026-07-17T08:00:00Z");
    // An absent date stays absent — never backfilled from observation time.
    expect(results[1].sourcePublishedAt).toBeUndefined();
    expect(results[1].observedAt).toBe("2026-07-19T12:00:00.000Z");
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
      urls: ["https://old.reddit.com/r/CrimsonDesert/comments/thin/current_patch/"],
      query: "Crimson Desert current patch issue crash stutter performance fixed still happening player report",
      chunks_per_source: 5,
      extract_depth: "basic",
      include_usage: true,
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

  it("returns null when Tavily states it refused the URL", async () => {
    // The real shape Reddit produces: 200, no results, the URL named in
    // failed_results. Tavily does not bill this, so null means confirmed unbilled.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [],
        failed_results: [
          { url: "https://old.reddit.com/r/CrimsonDesert/comments/thin/", error: "Failed to fetch url" },
        ],
      }),
    }));

    const raw = await tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
    });

    expect(raw).toBeNull();
  });

  it("throws when an empty extract response never states a refusal", async () => {
    // 200 with nothing usable and no stated refusal: Tavily may already have billed
    // the work behind it. Returning null here would claim it was free.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    await expect(
      tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
      }),
    ).rejects.toThrow("tavily extract returned no content");
  });

  it("throws when the extract response carries a result with blank text", async () => {
    // Reported usage with empty raw_content is the same ambiguity: charged worst case.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ url: "https://old.reddit.com/x", raw_content: "   " }] }),
    }));

    await expect(
      tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
      }),
    ).rejects.toThrow("tavily extract returned no content");
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
