import { describe, expect, it, vi } from "vitest";
import { buildSearchQueries, buildWireNewsQuery, tavilyExtract, tavilySearch } from "@/lib/automation/search";

describe("automation search planning", () => {
  it("leads with Reddit-targeted queries at low query budgets", () => {
    expect(buildSearchQueries(2, "1.14.00")).toEqual([
      "site:reddit.com r/CrimsonDesert Crimson Desert patch 1.14.00 crash stutter performance bug",
      "site:reddit.com Crimson Desert patch 1.14.00 crash freeze stutter issue",
    ]);
  });

  it("leads with Reddit/subreddit targeting while keeping Steam and general-web diversity", () => {
    const queries = buildSearchQueries(999, "1.14.00");
    const combined = queries.join(" ");

    expect(queries).toHaveLength(6);
    // Reddit-weighted: an r/CrimsonDesert-targeted query leads the pack.
    expect(queries.some((q) => q.includes("site:reddit.com") && q.includes("r/CrimsonDesert"))).toBe(true);
    // Domain-diversity guardrail: keep the Steam query AND at least one general (non-`site:`)
    // web query so clusters can still reach 2-independent-domain corroboration.
    expect(queries.some((q) => q.includes("site:steamcommunity.com"))).toBe(true);
    expect(queries.some((q) => !q.includes("site:"))).toBe(true);
    expect(combined).toMatch(/crash.*freeze|freeze.*crash/i);
    expect(combined).toMatch(/FPS|performance/i);
    expect(combined).toContain("PS5");
    expect(combined).toContain("PC");
    expect(combined).toContain("patch 1.14.00");
  });

  it("stays domain-diverse (not Reddit-only) so clusters can still corroborate across domains", () => {
    const queries = buildSearchQueries(999, "1.14.00");
    // At least one query is not scoped to reddit.com, so signals can span >= 2 registrable
    // domains and clear the promotion path's 2-independent-domain corroboration bar. This
    // guards against a future edit silently making the pack Reddit-exclusive.
    expect(queries.some((q) => !q.includes("site:reddit.com"))).toBe(true);
  });

  it("rotates focused query themes by offset and wraps around the pack", () => {
    expect(buildSearchQueries(3, "1.14.00", { rotationOffset: 4 })).toEqual([
      "Crimson Desert patch 1.14.00 crash freeze issue",
      "Crimson Desert PS5 PC performance drops patch 1.14.00",
      "site:reddit.com r/CrimsonDesert Crimson Desert patch 1.14.00 crash stutter performance bug",
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

    await tavilySearch(buildWireNewsQuery("1.14.00"), {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
      topic: "news",
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.topic).toBe("news");
    expect(body.query).toContain("Crimson Desert patch 1.14.00");
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

  it.each([
    ["an entry with no url", [{}]],
    ["a bare string entry", ["https://old.reddit.com/r/CrimsonDesert/comments/thin/"]],
    ["an entry for a different url", [{ url: "https://old.reddit.com/r/OtherSub/comments/other/", error: "x" }]],
    ["a null entry", [null]],
  ])("throws when the stated refusal is %s", async (_label, failedResults) => {
    // A refusal only waives the charge when Tavily names the URL we asked for.
    // Corrupted provider data says nothing about whether the work was billed, so
    // it must take the throwing path and be charged worst case — length alone is
    // not evidence of an unbilled outcome.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [], failed_results: failedResults }),
    }));

    await expect(
      tavilyExtract("https://reddit.com/r/CrimsonDesert/comments/thin/", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
      }),
    ).rejects.toThrow("tavily extract returned no content");
  });

  it("matches the refusal against the rewritten URL, not the one passed in", async () => {
    // Reddit URLs are rewritten to old.reddit.com before the request, so the
    // comparison must use the URL actually sent or every Reddit refusal would look
    // corrupted and be charged.
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [],
        failed_results: [{ url: "https://www.reddit.com/r/CrimsonDesert/comments/thin/", error: "Failed to fetch url" }],
      }),
    }));

    await expect(
      tavilyExtract("https://www.reddit.com/r/CrimsonDesert/comments/thin/", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
      }),
    ).rejects.toThrow("tavily extract returned no content");
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
