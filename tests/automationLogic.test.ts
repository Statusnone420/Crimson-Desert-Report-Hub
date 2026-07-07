import { describe, expect, it, vi } from "vitest";
import { canonicalizeUrl, semanticFingerprint } from "@/lib/automation/dedupe";
import {
  deterministicExtract,
  extractSignalWithOpenRouter,
  parseOpenRouterExtraction,
} from "@/lib/automation/extract";
import { countIndependentDomains, domainTier, registrableDomain } from "@/lib/automation/domains";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { evaluateCurrentPatchEligibility } from "@/lib/automation/eligibility";
import { buildMemorySearchQueries, chooseScanIntent } from "@/lib/automation/memory";
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

  it("uses DeepSeek Flash first even when a legacy free-model env var exists", async () => {
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
                clusterSlug: null,
              }),
            },
          },
        ],
        usage: { cost: 0.0002 },
      }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
        OPENROUTER_FREE_MODEL: "openai/gpt-4.1",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).model).toBe("deepseek/deepseek-v4-flash");
    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("deepseek/deepseek-v4-flash");
    expect(result.llmCostUsd).toBe(0.0002);
  });

  it("falls back without calling OpenRouter when config is missing", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {},
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.extractionModel).toBeNull();
    expect(result.llmCallsUsed).toBe(0);
    expect(result.llmCostUsd).toBe(0);
    expect(result.fallbackReason).toBe("openrouter_missing_config");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back without calling OpenRouter when there is no LLM allowance", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 0,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(0);
    expect(result.fallbackReason).toBe("llm_allowance_exhausted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back without calling OpenRouter when the LLM dollar cap is exhausted", async () => {
    const fetcher = vi.fn();

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 1,
      llmBudgetRemainingUsd: 0,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(0);
    expect(result.fallbackReason).toBe("llm_budget_capped");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses strict JSON Schema with the DeepSeek primary model", async () => {
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
                clusterSlug: null,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
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
        },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("deepseek/deepseek-v4-flash");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.llmCostUsd).toBeCloseTo(0.00018, 8);
    expect(result.category).toBe("performance");
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer key" }),
      }),
    );
    const [, init] = fetcher.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: expect.objectContaining({
            required: ["issueTitle", "category", "platform", "confidence", "summary", "clusterSlug"],
          }),
        },
      },
    });
    expect(JSON.parse(init.body).messages[1].content).toContain("clusterSlug");
  });

  it("records an estimated LLM cost when OpenRouter omits usage metadata", async () => {
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
                clusterSlug: null,
              }),
            },
          },
        ],
      }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 1,
      llmBudgetRemainingUsd: 1,
    });

    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("deepseek/deepseek-v4-flash");
    expect(result.llmCostUsd).toBeGreaterThan(0);
    expect(result.llmCostUsd).toBeCloseTo(0.000207, 8);
  });

  it("falls back to deterministic extraction when OpenRouter returns invalid JSON", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{not json" } }],
        usage: { cost: 0.0002 },
      }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.llmCostUsd).toBe(0.0002);
    expect(result.fallbackReason).toBe("openrouter_invalid_json");
  });

  it("falls back to deterministic extraction when OpenRouter provider request fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.fallbackReason).toBe("openrouter_provider_failure");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds after an initial invalid-JSON failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "{not json" } }], usage: { cost: 0.0002 } }),
      })
      .mockResolvedValueOnce({
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
                  clusterSlug: null,
                }),
              },
            },
          ],
          usage: { cost: 0.0003 },
        }),
      });

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 2,
    });

    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("qwen/qwen3-235b-a22b-2507");
    expect(result.llmCallsUsed).toBe(2);
    expect(result.llmCostUsd).toBe(0.0005);
    expect(result.fallbackReason).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const models = fetcher.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body).model);
    expect(models).toEqual(["deepseek/deepseek-v4-flash", "qwen/qwen3-235b-a22b-2507"]);
  });

  it("falls back to deterministic extraction with the last failure reason after two failed attempts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "{not json" } }], usage: { cost: 0.0002 } }),
      })
      .mockRejectedValueOnce(new Error("network down"));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 2,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(2);
    expect(result.llmCostUsd).toBe(0.0002);
    expect(result.fallbackReason).toBe("openrouter_provider_failure");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses DeepSeek Pro as a third rescue model when budget allows", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "{not json" } }], usage: { cost: 0.0002 } }),
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
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
                  clusterSlug: null,
                }),
              },
            },
          ],
          usage: { cost: 0.001 },
        }),
      });

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 3,
      llmBudgetRemainingUsd: 1,
    });

    expect(result.extractionProvider).toBe("openrouter");
    expect(result.extractionModel).toBe("deepseek/deepseek-v4-pro");
    expect(result.llmCallsUsed).toBe(3);
    expect(result.llmCostUsd).toBeCloseTo(0.0012, 8);
    const models = fetcher.mock.calls.map(([, init]) => JSON.parse((init as { body: string }).body).model);
    expect(models).toEqual([
      "deepseek/deepseek-v4-flash",
      "qwen/qwen3-235b-a22b-2507",
      "deepseek/deepseek-v4-pro",
    ]);
  });

  it("charges invalid JSON attempts before retry budget checks", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "{not json" } }], usage: { cost: 0.0002 } }),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 2,
      llmBudgetRemainingUsd: 0.0003,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.llmCostUsd).toBe(0.0002);
    expect(result.fallbackReason).toBe("llm_budget_capped");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry beyond the LLM allowance when only one call remains", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const result = await extractSignalWithOpenRouter(crashCandidate, {
      env: {
        OPENROUTER_API_KEY: "key",
      },
      fetcher,
      llmCallsRemaining: 1,
    });

    expect(result.extractionProvider).toBe("deterministic");
    expect(result.llmCallsUsed).toBe(1);
    expect(result.fallbackReason).toBe("openrouter_provider_failure");
    expect(fetcher).toHaveBeenCalledTimes(1);
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

  it("does not treat a trusted apex embedded in another domain as trusted", () => {
    expect(domainTier("reddit.com.evil.com")).toBe("unknown");
  });

  it("treats null as unknown", () => {
    expect(domainTier(null)).toBe("unknown");
  });
});

describe("registrableDomain", () => {
  it("collapses sibling subdomains to one registrable domain", () => {
    expect(registrableDomain("a.evilfarm.com")).toBe("evilfarm.com");
    expect(registrableDomain("b.evilfarm.com")).toBe("evilfarm.com");
    expect(registrableDomain("old.reddit.com")).toBe("reddit.com");
  });

  it("strips www and trailing dots", () => {
    expect(registrableDomain("www.pcgamer.com")).toBe("pcgamer.com");
    expect(registrableDomain("example.com.")).toBe("example.com");
  });

  it("keeps the eTLD+1 for multi-part public suffixes", () => {
    expect(registrableDomain("sub.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.co.uk")).toBe("example.co.uk");
  });

  it("returns null for empty input", () => {
    expect(registrableDomain(null)).toBeNull();
    expect(registrableDomain("")).toBeNull();
  });
});

describe("countIndependentDomains", () => {
  it("counts sibling subdomains of one registrable domain as a single source", () => {
    expect(countIndependentDomains(["a.evilfarm.com", "b.evilfarm.com", "c.evilfarm.com"])).toEqual({
      independentDomainCount: 1,
      trustedDomainCount: 0,
    });
  });

  it("counts genuinely distinct registrable domains and flags trusted ones", () => {
    expect(countIndependentDomains(["old.reddit.com", "randomblog.example"])).toEqual({
      independentDomainCount: 2,
      trustedDomainCount: 1,
    });
  });
});

describe("scanner memory planning", () => {
  it("never returns quarantine even when stale public signals exist, so the run can still search", () => {
    // Staleness is handled by the always-on quarantine step in run.ts, not by the
    // intent. Stale signals must no longer suppress searching.
    for (const rotationOffset of [0, 1, 2, 3]) {
      const intent = chooseScanIntent(
        {
          stalePublicSignals: 3,
          privateSignals: 0,
          rejectedCandidates: 0,
          targetClusterTitles: [],
          recentRuns: [],
        },
        rotationOffset,
      );

      expect(intent).not.toBe("quarantine");
      expect(buildMemorySearchQueries(1, "1.13.00", intent, { rotationOffset })).not.toEqual([]);
    }
  });

  it("keeps discovery in the rotation even when rescue and corroborate backlogs both exist", () => {
    const intents = new Set(
      [0, 1, 2, 3, 4, 5].map((rotationOffset) =>
        chooseScanIntent(
          {
            stalePublicSignals: 0,
            privateSignals: 4,
            rejectedCandidates: 4,
            targetClusterTitles: ["Shader compilation stutter"],
            recentRuns: [],
          },
          rotationOffset,
        ),
      ),
    );

    // Discovery is not starved: at least one discovery lane appears across the rotation.
    expect(intents.has("broad_discovery") || intents.has("forum_discovery")).toBe(true);
    // The backlogs still get their turns.
    expect(intents.has("corroborate_cluster")).toBe(true);
    expect(intents.has("rescue_candidate")).toBe(true);
  });

  it("still emits forum_discovery when a single backlog gates the discovery slot to even offsets", () => {
    // One backlog (rescue) → laneCount 2, so the discovery slot only lands on even
    // offsets. Broad/forum must advance per discovery TURN, not raw offset parity, or
    // forum_discovery (the site:reddit / site:steam lane) would never fire.
    const intents = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map((rotationOffset) =>
        chooseScanIntent(
          {
            stalePublicSignals: 0,
            privateSignals: 0,
            rejectedCandidates: 4,
            targetClusterTitles: [],
            recentRuns: [],
          },
          rotationOffset,
        ),
      ),
    );

    expect(intents.has("forum_discovery")).toBe(true);
    expect(intents.has("broad_discovery")).toBe(true);
    expect(intents.has("rescue_candidate")).toBe(true);
  });

  it("rotates corroborate_cluster through every target cluster title", () => {
    const titles = ["First cluster", "Second cluster", "Third cluster"];
    for (let rotationOffset = 0; rotationOffset < titles.length; rotationOffset += 1) {
      const [query] = buildMemorySearchQueries(1, "1.13.00", "corroborate_cluster", {
        rotationOffset,
        targetClusterTitles: titles,
      });
      expect(query).toContain(titles[rotationOffset % titles.length]);
    }
  });

  it("covers every target title once per corroborate turn when a lane offset gates selection", () => {
    // With 2 eligible lanes, corroborate only fires on odd offsets (1, 3, 5, 7).
    // Advancing the title per corroborate TURN (offset / laneCount) instead of per
    // raw offset guarantees all four titles get hunted — not just an even/odd half.
    const titles = ["Alpha crash", "Beta stutter", "Gamma freeze", "Delta hitch"];
    const laneCount = 2;
    const hunted = new Set<string>();
    for (const rotationOffset of [1, 3, 5, 7]) {
      const [query] = buildMemorySearchQueries(1, "1.13.00", "corroborate_cluster", {
        rotationOffset,
        targetClusterTitles: titles,
        laneCount,
      });
      const matched = titles.find((title) => query.includes(title));
      if (matched) hunted.add(matched);
    }
    // The OLD `rotationOffset % titles.length` selection would have hit only
    // indices {1, 3} — two titles — across those offsets. Per-turn selection hits all four.
    expect(hunted.size).toBe(4);
  });

  it("still returns no queries for the quarantine intent value when it is passed directly", () => {
    expect(buildMemorySearchQueries(1, "1.13.00", "quarantine")).toEqual([]);
  });
});

describe("automation relevance", () => {
  describe("evaluateCurrentPatchEligibility", () => {
    it("hides explicit old-patch source links for the current patch", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "MASSIVE frame drops and stuttering after 1.04",
            snippet: "Players discuss patch 1.04 regressions.",
            sourcePublishedAt: "2026-06-01T12:00:00.000Z",
          },
          { version: "1.13.00", publishedAt: "2026-07-03T03:00:00.000Z" },
        ),
      ).toEqual({ canStore: false, canPublish: false, reason: "wrong_patch" });
    });

    it("keeps current-patch complaints eligible for public evidence", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "Crimson Desert patch 1.13 FPS drops",
            snippet: "Players report stutter after patch 1.13.",
            sourcePublishedAt: "2026-07-05T12:00:00.000Z",
          },
          { version: "1.13.00", publishedAt: "2026-07-03T03:00:00.000Z" },
        ),
      ).toEqual({ canStore: true, canPublish: true, reason: "current_patch" });
    });

    it("blocks sources published before the current patch from public evidence", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "Crashes occur when opening the map",
            snippet: "Players report crashes.",
            sourcePublishedAt: "2026-06-30T12:00:00.000Z",
          },
          { version: "1.13.00", publishedAt: "2026-07-03T03:00:00.000Z" },
        ),
      ).toEqual({ canStore: false, canPublish: false, reason: "stale_source" });
    });

    it("treats date-only sources on the patch publish day as current enough", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "Crashes occur when opening the map",
            snippet: "Players report crashes.",
            sourcePublishedAt: "2026-07-03",
          },
          { version: "1.13.00", publishedAt: "2026-07-03T03:00:00.000Z" },
        ),
      ).toEqual({ canStore: true, canPublish: true, reason: "fresh_source" });
    });
  });

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

    it("keeps current-patch complaint language from Reddit-style titles", () => {
      expect(
        preScreenCandidate(
          {
            title: "Awful performance after patch 1.13",
            snippet: "base PS5 performance on 1.13 is HORRIBLE after the latest update",
            sourceDomain: "reddit.com",
          },
          { currentPatchVersion: "1.13.00" },
        ),
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

    it("rejects after-version complaints for old patch numbers", () => {
      expect(
        preScreenCandidate(
          {
            title: "Awful performance after 1.04",
            snippet: "stutter and low fps since v1.04",
            sourceDomain: "steamcommunity.com",
          },
          { currentPatchVersion: "1.13.00" },
        ),
      ).toEqual({ keep: false, reason: "wrong_patch" });
    });

    it("rejects known stale source dates before the current patch", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crashes occur when opening the map",
            snippet: "Players report crashes.",
            sourceDomain: "reddit.com",
            sourcePublishedAt: "2026-06-30T12:00:00.000Z",
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: "2026-07-03T03:00:00.000Z" },
        ),
      ).toEqual({ keep: false, reason: "stale_source" });
    });

    it("rejects an official patch-note claimed-fix line even when it mentions a symptom word", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert - Steam Community",
            snippet:
              "Fixed an issue where the game would crash when using Photo Mode after turning off HDR while it was on.",
            sourceDomain: "steamcommunity.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("rejects official claimed-fix lines that mention back controls or navigation", () => {
      const snippets = [
        "Fixed an issue where pressing the back button would crash the game.",
        "Fixed an issue where returning back to the title screen would crash the game.",
        "Fixed an issue where the game would crash when coming back into the title screen.",
        "Fixed an issue where the game would crash when coming back in the title screen.",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crimson Desert - Steam Community",
              snippet,
              sourceDomain: "steamcommunity.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: false, reason: "source_not_issue_report" });
      }
    });

    it("keeps a complaint that says the claimed-fix symptom is back", () => {
      expect(
        preScreenCandidate(
          {
            title: "map crash after 1.13.00",
            snippet: "they fixed an issue where the map crashes, but the crash is back on 1.13.00",
            sourceDomain: "example.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a complaint that says claimed-fix FPS drops are back", () => {
      expect(
        preScreenCandidate(
          {
            title: "FPS drops after 1.13.00",
            snippet: "they fixed an issue where FPS drops happen, but the FPS drops are back on 1.13.00",
            sourceDomain: "example.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a complaint that says claimed-fix CTDs are back", () => {
      expect(
        preScreenCandidate(
          {
            title: "CTD is back after 1.13.00",
            snippet: "they fixed an issue where the game crashed in Photo Mode",
            sourceDomain: "example.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a complaint that a claimed fix did not actually work", () => {
      expect(
        preScreenCandidate(
          {
            title: "map crash after 1.13.00",
            snippet: "they supposedly fixed an issue where the map crashes but it still crashes every time on 1.13.00",
            sourceDomain: "example.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("rejects a patch fix-announcement snippet framed as a performance fix", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert patch 1.13.00 update with new armor and content",
            snippet: "Patch 1.13.00 includes PS5 performance fixes aimed at achieving stable 60fps on base PS5",
            sourceDomain: "facebook.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("rejects a fix-announcement even when it names a symptom keyword", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert patch 1.13.00 update",
            snippet: "Patch 1.13.00 improves performance and fixes the fps drops on base PS5",
            sourceDomain: "facebook.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("keeps a persistence-guarded complaint that mentions an improvement claim", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "they fixed an issue where the game stutters, but performance is still awful after 1.13.00",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a negative-polarity complaint that quotes a performance-improvement claim", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "they said 1.13.00 improves performance but it's worse now, constant fps drops",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a complaint that quotes an improvement claim then reports a crash symptom", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crashes after 1.13.00",
            snippet: "They said this patch improves performance but my game crashes on the title screen",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a complaint asking where the performance fixes are while reporting crashes and freezes", () => {
      expect(
        preScreenCandidate(
          {
            title: "1.13.00 stability",
            snippet: "where are the performance fixes? game crashes and freezes every session",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
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
          llmCallsUsed: 1,
          llmCostUsd: 0,
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
          llmCallsUsed: 1,
          llmCostUsd: 0,
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
    expect(buildSearchQueries(999)).toHaveLength(6);
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
