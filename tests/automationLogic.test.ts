import { describe, expect, it, vi } from "vitest";
import { canonicalizeUrl, semanticFingerprint } from "@/lib/automation/dedupe";
import {
  deterministicExtract,
  extractSignalWithOpenRouter,
  parseOpenRouterExtraction,
} from "@/lib/automation/extract";
import { domainTier } from "@/lib/automation/domains";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { preScreenCandidate, shouldKeepExtractedSignal } from "@/lib/automation/relevance";
import { buildSearchQueries, tavilySearch } from "@/lib/automation/search";
import { parseClaimedFixes, parseOfficialNoticeList, parseOfficialPatchDetail, patchVersionFromTitle } from "@/lib/officialPatch";

const crashCandidate = {
  title: "Crimson Desert map crash still happens",
  snippet: "Game crashes to desktop when opening the map after patch 1.13.",
  url: "https://example.com/a",
};

describe("automation dedupe", () => {
  it("canonicalizes URLs and ignores tracking params", () => {
    expect(canonicalizeUrl("https://example.com/post?utm_source=x&id=1&fbclid=abc#comments")).toBe(
      "https://example.com/post?id=1",
    );
  });

  it("builds stable semantic fingerprints", () => {
    expect(semanticFingerprint("FPS drops since 1.13!", "performance")).toBe(
      semanticFingerprint("fps   drops since 1.13", "performance"),
    );
  });
});

describe("automation extraction", () => {
  it("deterministically classifies common issue language", () => {
    const result = deterministicExtract(crashCandidate);
    expect(result.category).toBe("crash_startup");
    expect(result.confidence).toBe("medium");
    expect(result.issueTitle).toContain("map crash");
    expect(result.clusterSlug).toBeNull();
  });

  it("parses strict OpenRouter JSON and rejects invalid categories", () => {
    expect(
      parseOpenRouterExtraction(
        JSON.stringify({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "high",
          summary: "Multiple PC players mention FPS drops after patch 1.13.",
        }),
      ).category,
    ).toBe("performance");
    expect(() => parseOpenRouterExtraction(JSON.stringify({ category: "made_up" }))).toThrow(/category/);
  });

  it("keeps clusterSlug when it is present in validSlugs", () => {
    expect(
      parseOpenRouterExtraction(
        JSON.stringify({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "high",
          summary: "Multiple PC players mention FPS drops after patch 1.13.",
          clusterSlug: "performance_regression",
        }),
        ["performance_regression"],
      ).clusterSlug,
    ).toBe("performance_regression");
  });

  it("nulls clusterSlug when it is not in validSlugs", () => {
    expect(
      parseOpenRouterExtraction(
        JSON.stringify({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "high",
          summary: "Multiple PC players mention FPS drops after patch 1.13.",
          clusterSlug: "not_a_real_slug",
        }),
        ["performance_regression"],
      ).clusterSlug,
    ).toBeNull();
  });

  it("nulls clusterSlug when the field is missing", () => {
    expect(
      parseOpenRouterExtraction(
        JSON.stringify({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "high",
          summary: "Multiple PC players mention FPS drops after patch 1.13.",
        }),
        ["performance_regression"],
      ).clusterSlug,
    ).toBeNull();
  });

  it("falls back without calling OpenRouter when the configured model is not free", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "openai/gpt-4.1",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.extractionModel).toBeNull();
    expect(result.llmCallUsed).toBe(false);
    expect(result.fallbackReason).toBe("openrouter_paid_model");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back without calling OpenRouter when config is missing", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_FREE_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.extractionModel).toBeNull();
    expect(result.llmCallUsed).toBe(false);
    expect(result.fallbackReason).toBe("openrouter_missing_config");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back without calling OpenRouter when there is no LLM allowance", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      },
      fetcher,
      llmCallsRemaining: 0,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallUsed).toBe(false);
    expect(result.fallbackReason).toBe("llm_allowance_exhausted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses a free OpenRouter model with mocked fetch", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                issueTitle: "FPS regression since 1.13",
                category: "performance",
                platform: "pc_steam",
                confidence: "high",
                summary: "Players on Steam report FPS drops after patch 1.13.",
              }),
            },
          },
        ],
      }),
    }));

    const result = await extractSignalWithOpenRouter(
      {
        title: "FPS drops since 1.13",
        snippet: "Steam users are seeing stutter after the latest patch.",
        url: "https://example.com/fps",
      },
      {
        env: {
          OPENROUTER_API_KEY: "key",
          OPENROUTER_FREE_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
        },
        fetcher,
        llmCallsRemaining: 1,
      },
    );

    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(result.llmCallUsed).toBe(true);
    expect(result.category).toBe("performance");
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer key" }),
      }),
    );
  });

  it("uses OpenRouter's free router with structured JSON requested", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                issueTitle: "Map crash after patch",
                category: "crash_startup",
                platform: "ps5",
                confidence: "medium",
                summary: "Players report map-open crashes after the patch.",
              }),
            },
          },
        ],
      }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "openrouter/free",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      model: "openrouter/free",
      response_format: { type: "json_object" },
    });
    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("openrouter/free");
  });

  it("falls back to deterministic extraction when OpenRouter returns invalid JSON", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{not json" } }],
      }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallUsed).toBe(true);
    expect(result.fallbackReason).toBe("openrouter_invalid_json");
  });

  it("falls back to deterministic extraction when OpenRouter provider request fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallUsed).toBe(true);
    expect(result.fallbackReason).toBe("openrouter_provider_failure");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("automation promotion", () => {
  it("keeps two signals from the same domain private (below threshold)", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 1,
        trustedDomainCount: 0,
        directReportCount: 0,
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "private", reason: "below_threshold" });
  });

  it("promotes two independent domains when at least one is trusted", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 2,
        trustedDomainCount: 1,
        directReportCount: 0,
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "two_independent_domains_trusted" });
  });

  it("promotes three independent domains even without a trusted one", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 3,
        trustedDomainCount: 0,
        directReportCount: 0,
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "three_independent_domains" });
  });

  it("keeps two untrusted-only domains private", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 2,
        trustedDomainCount: 0,
        directReportCount: 0,
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "private", reason: "below_threshold" });
  });

  it("direct report promotes regardless of domain counts", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 0,
        trustedDomainCount: 0,
        directReportCount: 1,
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "direct_report_match" });
  });

  it("admin force public promotes below-threshold signals", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 0,
        trustedDomainCount: 0,
        directReportCount: 0,
        hasAdminForcePublic: true,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "admin_force_public" });
  });

  it("admin force hidden wins over force public", () => {
    expect(
      shouldPromoteSignalCluster({
        independentDomainCount: 3,
        trustedDomainCount: 3,
        directReportCount: 3,
        hasAdminForcePublic: true,
        hasAdminForceHidden: true,
      }),
    ).toEqual({ publicStatus: "hidden", reason: "admin_force_hidden" });
  });
});

describe("domainTier", () => {
  it("treats a subdomain of a trusted domain as trusted", () => {
    expect(domainTier("old.reddit.com")).toBe("trusted");
  });

  it("does not treat a look-alike domain as trusted", () => {
    expect(domainTier("evilreddit.com")).toBe("unknown");
  });

  it("treats null as unknown", () => {
    expect(domainTier(null)).toBe("unknown");
  });
});

describe("automation relevance", () => {
  describe("preScreenCandidate", () => {
    it("rejects broad content titles like patch notes", () => {
      expect(
        preScreenCandidate({
          title: "Crimson Desert patch notes",
          snippet: "Official update notes and balance changes.",
          sourceDomain: "example.com",
        }),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("rejects issue language from a different patch than the current one", () => {
      expect(
        preScreenCandidate(
          {
            title: "Game crashes on map open",
            snippet: "since patch 1.12",
            sourceDomain: "example.com",
          },
          { currentPatchVersion: "1.13.00" },
        ),
      ).toEqual({ keep: false, reason: "wrong_patch" });
    });

    it("rejects titles and snippets with no symptom language", () => {
      expect(
        preScreenCandidate({
          title: "Nice scenery tour",
          snippet: "beautiful vistas",
          sourceDomain: "example.com",
        }),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("keeps candidates with clear symptom language for the current patch", () => {
      expect(
        preScreenCandidate({
          title: "FPS drops hard in combat",
          snippet: "since 1.13 stutters constantly",
          sourceDomain: "example.com",
        }),
      ).toEqual({ keep: true });
    });

    it("rejects no-issue language even when symptom words are present", () => {
      expect(
        preScreenCandidate({
          title: "No crashes for me",
          snippet: "runs without issues",
          sourceDomain: "example.com",
        }),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("rejects SEO fix guides framed as troubleshooting content", () => {
      expect(
        preScreenCandidate({
          title: "How To Fix Crimson Desert Low FPS, Lag, Stuttering & FPS Drops",
          snippet: "A troubleshooting guide for Windows settings.",
          sourceDomain: "youtube.com",
        }),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("rejects issue reports pinned to a different explicit patch version", () => {
      expect(
        preScreenCandidate({
          title: "RTX 5080 Ruined After 1.04 Patch - Sudden FPS Drops & Heavy Stuttering",
          snippet: "Steam discussion about patch 1.04.",
          sourceDomain: "steamcommunity.com",
        }),
      ).toEqual({ keep: false, reason: "wrong_patch" });
    });
  });

  describe("shouldKeepExtractedSignal", () => {
    it("rejects an extraction classified as other", () => {
      expect(
        shouldKeepExtractedSignal({
          issueTitle: "Patch notes",
          category: "other",
          platform: null,
          confidence: "low",
          summary: "No reported issues.",
          clusterSlug: null,
          extractionProvider: "openrouter",
          extractionModel: "openrouter/free",
          llmCallUsed: true,
        }),
      ).toEqual({ keep: false, reason: "category_other" });
    });

    it("keeps an extraction classified with a real category", () => {
      expect(
        shouldKeepExtractedSignal({
          issueTitle: "FPS regression since 1.13",
          category: "performance",
          platform: "pc_steam",
          confidence: "medium",
          summary: "Players report FPS drops on Steam after patch 1.13.",
          clusterSlug: null,
          extractionProvider: "openrouter",
          extractionModel: "openrouter/free",
          llmCallUsed: true,
        }),
      ).toEqual({ keep: true });
    });
  });
});

describe("search planning", () => {
  it("never emits more queries than the cap", () => {
    expect(buildSearchQueries(3)).toHaveLength(3);
    expect(buildSearchQueries(0)).toHaveLength(0);
  });

  it("targets issue language instead of broad reviews or patch-note pages", () => {
    expect(buildSearchQueries(2)).toEqual([
      "Crimson Desert patch 1.13.00 FPS drops stutter issue",
      "Crimson Desert patch 1.13.00 crash freeze issue",
    ]);
  });

  it("caps query planning to the fixed query pack", () => {
    expect(buildSearchQueries(999)).toHaveLength(5);
  });

  it("can target a server-derived patch version", () => {
    expect(buildSearchQueries(1, "1.14.00")).toEqual(["Crimson Desert patch 1.14.00 FPS drops stutter issue"]);
  });

  it("calls Tavily with injected fetch and maps results", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Crimson Desert patch 1.13 FPS regression",
            url: "https://www.example.com/fps?utm_source=news",
            content: "Players report FPS drops on Steam.",
          },
          { title: "Missing URL", content: "ignored" },
        ],
      }),
    }));

    const results = await tavilySearch("Crimson Desert FPS", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
      now: new Date("2026-07-05T12:00:00Z"),
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tavily-key",
          "content-type": "application/json",
        }),
      }),
    );
    const [, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toMatchObject({
      query: "Crimson Desert FPS",
      max_results: 5,
      search_depth: "basic",
    });
    expect(results).toEqual([
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://www.example.com/fps?utm_source=news",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
  });

  it("skips malformed Tavily result URLs", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Bad result",
            url: "not a url",
            content: "This malformed result should be ignored.",
          },
          {
            title: "Crimson Desert crash report",
            url: "https://reports.example/crash",
            content: "Players report a crash when opening the map.",
          },
        ],
      }),
    }));

    await expect(
      tavilySearch("Crimson Desert crash", {
        env: { TAVILY_API_KEY: "tavily-key" },
        fetcher,
        now: new Date("2026-07-05T12:00:00Z"),
      }),
    ).resolves.toEqual([
      {
        title: "Crimson Desert crash report",
        url: "https://reports.example/crash",
        snippet: "Players report a crash when opening the map.",
        sourceDomain: "reports.example",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
  });
});

describe("official patch metadata", () => {
  it("extracts a patch version from the official title format", () => {
    expect(patchVersionFromTitle("Patch Notes Version 1.13.00")).toBe("1.13.00");
    expect(patchVersionFromTitle("Known Issues")).toBeNull();
  });

  it("parses the latest official patch note from the notice list", () => {
    const html = `
      <a href="/en-US/News/Notice/Detail?_boardNo=105">
        <img src="/patch.jpg" alt="" />
        <p class="title css-ellipsis">Patch Notes Version 1.13.00</p>
      </a>
      <a href="/en-US/News/Notice/Detail?_boardNo=104">
        <p class="title css-ellipsis">Known Issues</p>
      </a>
    `;

    expect(parseOfficialNoticeList(html)).toEqual({
      boardNo: "105",
      title: "Patch Notes Version 1.13.00",
      patchVersion: "1.13.00",
      officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
    });
  });

  it("parses detail metadata without storing the full patch article", () => {
    const detail = parseOfficialPatchDetail(
      `
        <meta property="og:title" content="[Updates] Patch Notes Version 1.13.00 | Crimson Desert" />
        <meta name="description" content="This patch adds fixes and stability improvements." />
        <h1>Patch Notes Version 1.13.00</h1>
        <time>Jul 3, 2026, 03:00 (UTC)</time>
      `,
      {
        boardNo: "105",
        title: "Patch Notes Version 1.13.00",
        patchVersion: "1.13.00",
        officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
      },
    );

    expect(detail).toMatchObject({
      boardNo: "105",
      title: "Patch Notes Version 1.13.00",
      patchVersion: "1.13.00",
      publishedAt: "2026-07-03T03:00:00.000Z",
      summary: "This patch adds fixes and stability improvements.",
      claimedFixes: [],
    });
  });

  it("extracts claimed fixes from patch note list items", () => {
    const html = `
      <li>Fixed an issue where the map crashed the game.</li>
      <li>Improved lighting.</li>
      <li>Fixed the map crash.</li>
    `;

    expect(parseClaimedFixes(html)).toEqual([
      "Fixed an issue where the map crashed the game.",
      "Fixed the map crash.",
    ]);
  });

  it("drops claimed fix candidates outside the 12-300 char bounds", () => {
    const html = `
      <li>Fixed it.</li>
      <li>Fixed ${"a".repeat(295)}.</li>
    `;

    expect(parseClaimedFixes(html)).toEqual([]);
  });

  it("strips nested tags before evaluating claimed fix text", () => {
    const html = `<li>Fixed an issue where <b>the map</b> crashed <i>the game</i>.</li>`;

    expect(parseClaimedFixes(html)).toEqual(["Fixed an issue where the map crashed the game."]);
  });

  it("dedupes claimed fixes by lowercased text and caps at 30", () => {
    const html = Array.from({ length: 35 }, (_, index) => `<li>Fixed issue number ${index}.</li>`).join("\n");

    const fixes = parseClaimedFixes(html);
    expect(fixes).toHaveLength(30);
    expect(new Set(fixes.map((fix) => fix.toLowerCase())).size).toBe(30);
  });
});
