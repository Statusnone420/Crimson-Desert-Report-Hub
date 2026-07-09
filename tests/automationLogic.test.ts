import { describe, expect, it, vi } from "vitest";
import { canonicalizeUrl, semanticFingerprint } from "@/lib/automation/dedupe";
import {
  deterministicExtract,
  extractSignalWithOpenRouter,
  parseOpenRouterExtraction,
} from "@/lib/automation/extract";
import { countIndependentDomains, domainTier, registrableDomain } from "@/lib/automation/domains";
import { resolveSignalPublicStatus, shouldPromoteSignalCluster } from "@/lib/automation/promote";
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

describe("resolveSignalPublicStatus", () => {
  it("keeps a direct_report_match signal private when untrusted and not corroborated", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "public", reason: "direct_report_match" },
        signalTrusted: false,
        corroboratedByDomains: false,
      }),
    ).toEqual({ publicStatus: "private", reason: "below_threshold" });
  });

  it("promotes a direct_report_match signal from a trusted domain", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "public", reason: "direct_report_match" },
        signalTrusted: true,
        corroboratedByDomains: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "direct_report_match" });
  });

  it("promotes an untrusted direct_report_match signal when the cluster is domain-corroborated", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "public", reason: "direct_report_match" },
        signalTrusted: false,
        corroboratedByDomains: true,
      }),
    ).toEqual({ publicStatus: "public", reason: "direct_report_match" });
  });

  it("does not touch a two_independent_domains_trusted decision (untrusted, uncorroborated signal stays public)", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "public", reason: "two_independent_domains_trusted" },
        signalTrusted: false,
        corroboratedByDomains: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "two_independent_domains_trusted" });
  });

  it("passes through a non-public decision, preserving its reason", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "private", reason: "below_threshold" },
        signalTrusted: true,
        corroboratedByDomains: true,
      }),
    ).toEqual({ publicStatus: "private", reason: "below_threshold" });
  });

  it("preserves an admin_force_hidden decision as hidden (does not downgrade to private)", () => {
    expect(
      resolveSignalPublicStatus({
        decision: { publicStatus: "hidden", reason: "admin_force_hidden" },
        signalTrusted: false,
        corroboratedByDomains: false,
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

  it("uses exactly one site: filter per corroborate query and alternates forums across turns", () => {
    const patchVersion = "1.13.00";
    const target = "Shader stutter";
    const sitesSeen = new Set<string>();
    // laneCount defaults to 1, so turn === rotationOffset: offsets 0 and 1 are two
    // consecutive corroborate turns.
    for (const rotationOffset of [0, 1]) {
      const [query] = buildMemorySearchQueries(1, patchVersion, "corroborate_cluster", {
        rotationOffset,
        targetClusterTitles: [target],
      });
      // Exactly one reliable site: filter — no unverified `site:A OR site:B` in one query.
      const siteFilters = query.match(/site:\S+/g) ?? [];
      expect(siteFilters).toHaveLength(1);
      expect(query).not.toContain(" OR ");
      // Patch version and the rotated target title stay present in every corroborate query.
      expect(query).toContain(patchVersion);
      expect(query).toContain(target);
      for (const site of siteFilters) sitesSeen.add(site);
    }
    // Consecutive turns alternate across the two forums, preserving cross-domain diversity.
    expect(sitesSeen).toEqual(new Set(["site:reddit.com", "site:steamcommunity.com"]));
  });

  it("tries each corroboration target on both forums across turns", () => {
    const patchVersion = "1.13.00";
    const titles = ["Alpha crash", "Beta stutter"];
    const seen = new Map<string, Set<string>>();

    for (const rotationOffset of [0, 1, 2, 3]) {
      const [query] = buildMemorySearchQueries(1, patchVersion, "corroborate_cluster", {
        rotationOffset,
        targetClusterTitles: titles,
      });
      const title = titles.find((candidate) => query.includes(candidate));
      const site = query.includes("site:reddit.com")
        ? "reddit"
        : query.includes("site:steamcommunity.com")
          ? "steam"
          : null;
      expect(title).toBeTruthy();
      expect(site).toBeTruthy();
      if (title && site) {
        const sites = seen.get(title) ?? new Set<string>();
        sites.add(site);
        seen.set(title, sites);
      }
    }

    expect(seen.get("Alpha crash")).toEqual(new Set(["reddit", "steam"]));
    expect(seen.get("Beta stutter")).toEqual(new Set(["reddit", "steam"]));
  });

  it("targets r/CrimsonDesert for forum_discovery while keeping a Steam query for domain diversity", () => {
    const queries = buildMemorySearchQueries(2, "1.13.00", "forum_discovery");
    expect(queries).toHaveLength(2);
    // Reddit-weighted: the lead forum query is subreddit-targeted for the current patch.
    expect(queries[0]).toContain("site:reddit.com");
    expect(queries[0]).toContain("r/CrimsonDesert");
    expect(queries[0]).toContain("1.13.00");
    // Domain-diversity guardrail: the Steam query is retained so the lane isn't Reddit-only.
    expect(queries.some((q) => q.includes("site:steamcommunity.com"))).toBe(true);
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

    it("keeps hotfix-prefixed current-patch complaints eligible without a source date", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "Hotfix 1.13.01 crashes still happen",
            snippet: "Players report crashes after the hotfix.",
            sourcePublishedAt: null,
          },
          { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
        ),
      ).toEqual({ canStore: true, canPublish: true, reason: "current_patch" });
    });

    it("keeps same-family 1.13.00 evidence eligible after the 1.13.01 hotfix switch", () => {
      expect(
        evaluateCurrentPatchEligibility(
          {
            title: "Awful performance after patch 1.13.00",
            snippet: "Players report frame-rate drops since 1.13.00.",
            sourcePublishedAt: "2026-07-07T12:00:00.000Z",
          },
          { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" },
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

    it("rejects third-party patch-note reposts even when they quote claimed fixes", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert Patch 1.13.01 Released & Detailed",
            snippet:
              "Patch 1.13.01 fixes an issue where the game would occasionally crash when riding a bear. Improved an issue where frame rates would drop in certain environments.",
            sourceDomain: "dsogaming.com",
            sourcePublishedAt: "2026-07-08",
          },
          { currentPatchVersion: "1.13.01", currentPatchPublishedAt: "2026-07-08T05:51:00.000Z" },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("keeps patch-release titles when they contain complaint language", () => {
      expect(
        preScreenCandidate(
          {
            title: "Patch 1.13.01 released, but crashes still happen",
            snippet: "After the hotfix, crashes still happen when loading the map.",
            sourceDomain: "example.com",
            sourcePublishedAt: "2026-07-08",
          },
          { currentPatchVersion: "1.13.01", currentPatchPublishedAt: "2026-07-08T05:51:00.000Z" },
        ),
      ).toEqual({ keep: true });
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

    it("rejects dated old Steam discussions that only say today's update", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crash after todays update :: Crimson Desert General Discussions",
            snippet: "Apr 4 @ 1:45am I keep crashing when closing the map after the update.",
            sourceDomain: "steamcommunity.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.01", currentPatchPublishedAt: "2026-07-08T05:51:00.000Z" },
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

    it("rejects positive crash-fix announcement copy", () => {
      const snippets = [
        "Patch 1.13.00 includes performance fixes and crash fixes for PS5",
        "Patch 1.13.00 includes performance fixes and crash and freeze fixes for PS5",
        "Patch 1.13.00 includes crash, freeze, and hang fixes for PS5",
        "Patch 1.13.00 includes performance fixes and fixes crashes and freezes on PS5",
        "Patch 1.13.00 includes performance fixes and a fix for crash and freeze issues on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crimson Desert patch 1.13.00 update",
              snippet,
              sourceDomain: "facebook.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: false, reason: "source_not_issue_report" });
      }
    });

    it("rejects fix-announcement copy for broken symptom wording", () => {
      const snippets = [
        "Patch 1.13.00 includes a fix for broken audio on PS5",
        "Patch 1.13.00 includes a fix for broken rendering on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crimson Desert patch 1.13.00 update",
              snippet,
              sourceDomain: "facebook.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: false, reason: "source_not_issue_report" });
      }
    });

    it("keeps broken-symptom complaints when a claimed fix still fails", () => {
      const snippets = [
        "Patch 1.13.00 includes a fix for broken audio, but audio is still broken on PS5",
        "Patch 1.13.00 includes a fix for broken audio, but audio is broken on PS5",
        "Patch 1.13.00 includes a fix for broken audio, but it doesn't work; no sound on PS5",
        "Patch 1.13.00 includes a fix for broken rendering, but rendering is broken on PS5",
        "Patch 1.13.00 includes a fix for broken rendering, but it's no better on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Audio after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps contrastive broken-symptom complaints even without a persistence cue", () => {
      // These complaints contain no "still"/"persists"/"doesn't work"/"again"/"is back"/"no better",
      // so they must be rescued purely by the post-contrast symptom clause (not by FIX_PERSISTENCE_CUES).
      const snippets = [
        "Patch 1.13.00 includes a fix for broken audio, but no sound on PS5",
        "Patch 1.13.00 includes a fix for broken rendering, but shadows flicker on PS5",
        "fixed an issue where the map would crash, but it crashes on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "After 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });


    it("keeps a complaint that says the advertised FPS target is not stable", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "1.13.00 is not stable 60 fps on PS5, constant drops in combat",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a stutter rebuttal that quotes a stable-FPS claim", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "Stable 60 fps? Stutters constantly after 1.13.00",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a stutter rebuttal that quotes performance-improvement copy", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "Patch improves performance but the game stutters constantly after 1.13.00",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps a contrastive FPS-drop complaint that quotes a stable-FPS claim", () => {
      expect(
        preScreenCandidate(
          {
            title: "Performance after 1.13.00",
            snippet: "Patch claims stable 60 fps but fps drops to 20 in combat",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps FPS-drop and stutter complaints around performance-fix wording", () => {
      const snippets = [
        "1.13.00 performance improvements caused FPS drops",
        "FPS drops after the performance fixes",
        "patch 1.13 performance fixes are causing stutter",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Performance after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps audio-only current-patch complaints before extraction", () => {
      expect(
        preScreenCandidate(
          {
            title: "No sound after patch 1.13.00",
            snippet: "Audio is missing after the latest update.",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("keeps non-FPS complaints around performance-improvement wording", () => {
      const snippets = [
        "The performance improvements caused no sound on PS5",
        "The performance improvements are causing no sound on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "No sound after patch 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps visual complaints around performance-improvement wording", () => {
      const snippets = [
        "1.13 performance improvements caused shadow rendering to go missing",
        "The performance fixes are causing missing shadows on PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Graphics after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps loading and progression complaints around performance-improvement wording", () => {
      const snippets = [
        "1.13 performance improvements caused loading times to double",
        "The performance fixes are causing quests to get stuck",
        "Performance optimizations left NPCs missing after 1.13.00",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Patch problems after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps launch and input complaints around performance-improvement wording", () => {
      const snippets = [
        "The performance fixes made controls lock during combat",
        "Performance improvements are causing the game to not launch",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Controls after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("does not keep positive audio discussion as an issue report", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert soundtrack after 1.13.00",
            snippet: "The music sounds incredible after the latest patch.",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("keeps quest and NPC progression complaints before extraction", () => {
      const snippets = [
        "Quests are stuck after 1.13.00",
        "NPCs are frozen after the update",
        "I aimed to finish the quest but the NPC is missing after 1.13.00",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Progression after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps startup and loading complaints before extraction", () => {
      const snippets = [
        "Black screen after patch 1.13.00",
        "Infinite loading on startup after the update",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Startup after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps loading-time and frame-time performance complaints before extraction", () => {
      const snippets = [
        "Loading times are worse after 1.13.00",
        "Frame time spikes after the update",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Performance after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps graphics and visual complaints before extraction", () => {
      const snippets = [
        "The visuals are glitchy after 1.13.00",
        "Shadow rendering is broken after the update",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Graphics after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
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

    it("keeps a complaint that quotes an improvement claim then reports launch failure", () => {
      expect(
        preScreenCandidate(
          {
            title: "Launch failure after 1.13.00",
            snippet: "Patch 1.13 improves performance but the game won't launch on PS5",
            sourceDomain: "reddit.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: true });
    });

    it("rejects contrastive positive fix copy after an improvement claim", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert patch 1.13.00 update",
            snippet: "Patch 1.13 improves performance but fixes crashes too",
            sourceDomain: "facebook.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    it("keeps crash and freeze complaints around fix-list copy", () => {
      const snippets = [
        "Patch 1.13.00 includes performance fixes and crash and freeze fixes, but the game crashes on launch",
        "Patch 1.13.00 includes crash, freeze, and hang fixes, but the game freezes every session",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crashes after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
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

    // Root-cause regression guard. The announcement gate defines "is there a complaint?"
    // with the SINGLE shared SYMPTOM_PATTERNS list, not a parallel polarity list. So a
    // real symptom next to an announcement cue is kept for EVERY family — even with no
    // contrast word, no persistence cue, and no explicit "(optimizations) caused (X)"
    // structure (these quote the marketing verb, e.g. "Optimized"/"Boosted", which the
    // old per-family causal patterns required as the noun and therefore dropped).
    it("keeps complaints beside an announcement cue across every symptom family", () => {
      const snippets = [
        "Optimized performance, no audio in cutscenes on 1.13.00",
        "Improved framerate, shadows flicker constantly on 1.13.00",
        "Boosted performance, NPCs missing from the questline on 1.13.00",
        "Smoother performance sure, loading times are awful now on 1.13.00",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Regressions after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("still rejects pure marketing copy that carries no symptom", () => {
      expect(
        preScreenCandidate(
          {
            title: "Crimson Desert patch 1.13.00 update",
            snippet: "Optimized performance and smoother framerate on base PS5 after 1.13.00",
            sourceDomain: "facebook.com",
            sourcePublishedAt: null,
          },
          { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
        ),
      ).toEqual({ keep: false, reason: "source_not_issue_report" });
    });

    // Precision guard for the announcement gate, across EVERY symptom family. A patch note
    // that advertises fixing a symptom ("...and fixes <symptom>") must be rejected even
    // though the symptom noun appears — the fix-claim stripper removes the advertised
    // phrase so no residual complaint remains. One case per family so no family is the
    // "next crack" a reviewer can find.
    it("rejects advertised-fixed patch copy for every symptom family", () => {
      const snippets = [
        "Patch 1.13 improves performance and fixes a black screen on startup", // startup
        "Patch 1.13 improves performance and fixes the input lockups", // controls
        "Patch 1.13 improves performance and fixes missing NPCs", // quest
        "Patch 1.13 improves performance and fixes the slow loading times", // loading
        "Patch 1.13 improves performance and fixes stuttering", // perf
        "Patch 1.13 improves performance and fixes broken shadows", // visual
        "Patch 1.13 improves performance and fixes the missing audio", // audio
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crimson Desert patch 1.13.00 update",
              snippet,
              sourceDomain: "facebook.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: false, reason: "source_not_issue_report" });
      }
    });

    // The dual of the above: the SAME families, phrased as real complaints beside the same
    // announcement cue, must be KEPT. The stripper only removes fix-VERB-led phrases, so a
    // symptom reported as happening survives.
    it("keeps real complaints for every symptom family beside an announcement cue", () => {
      const snippets = [
        "improves performance but the game hits a black screen on startup after 1.13.00", // startup
        "improves performance but controls lock up randomly after 1.13.00", // controls
        "improves performance but NPCs are missing from the questline after 1.13.00", // quest
        "improves performance but loading times are awful now after 1.13.00", // loading
        "improves performance but the game stutters constantly after 1.13.00", // perf
        "improves performance but shadows are broken after 1.13.00", // visual
        "improves performance but there is no audio after 1.13.00", // audio
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Regressions after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    // Bare stutter / hitch / lag are the most common performance complaints and must reach
    // extraction even with no fps/frame qualifier — mirroring classifySignal so the
    // pre-screen doesn't drop what the classifier keeps.
    it("keeps bare stutter, hitch, and lag complaints", () => {
      const snippets = [
        "The game stutters constantly out in the desert now after 1.13.00",
        "Constant hitching every few seconds since 1.13.00",
        "The game lags horribly in every town after 1.13.00",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Bug after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("keeps complaints that a patch reduced/tanked fps or frame rate", () => {
      const snippets = [
        "The performance optimizations reduced my fps to a slideshow after 1.13.00",
        "The performance improvements tanked my frame rate after 1.13.00",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Bug after 1.13.00",
              snippet,
              sourceDomain: "reddit.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: true });
      }
    });

    it("still rejects marketing that advertises fixing lag or stutter", () => {
      const snippets = [
        "Patch 1.13 improves performance and fixes lag",
        "Patch 1.13 improves performance and reduces stutters on base PS5",
      ];

      for (const snippet of snippets) {
        expect(
          preScreenCandidate(
            {
              title: "Crimson Desert patch 1.13.00 update",
              snippet,
              sourceDomain: "facebook.com",
              sourcePublishedAt: null,
            },
            { currentPatchVersion: "1.13.00", currentPatchPublishedAt: null },
          ),
        ).toEqual({ keep: false, reason: "source_not_issue_report" });
      }
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

  it("leads with Reddit-targeted issue queries instead of broad reviews or patch-note pages", () => {
    expect(buildSearchQueries(2)).toEqual([
      "site:reddit.com r/CrimsonDesert Crimson Desert patch 1.13.01 crash stutter performance bug",
      "site:reddit.com Crimson Desert patch 1.13.01 crash freeze stutter issue",
    ]);
  });

  it("caps query planning to the fixed query pack", () => {
    expect(buildSearchQueries(999)).toHaveLength(6);
  });

  it("can target a server-derived patch version", () => {
    expect(buildSearchQueries(1, "1.14.00")).toEqual([
      "site:reddit.com r/CrimsonDesert Crimson Desert patch 1.14.00 crash stutter performance bug",
    ]);
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
      <li>Improved an issue where frame rates would drop in certain environments.</li>
      <li>Fixed the map crash.</li>
    `;

    expect(parseClaimedFixes(html)).toEqual([
      "Fixed an issue where the map crashed the game.",
      "Improved an issue where frame rates would drop in certain environments.",
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
