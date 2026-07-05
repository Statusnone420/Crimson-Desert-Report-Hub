import { describe, expect, it, vi } from "vitest";
import { canonicalizeUrl, semanticFingerprint } from "@/lib/automation/dedupe";
import {
  deterministicExtract,
  extractSignalWithOpenRouter,
  parseOpenRouterExtraction,
} from "@/lib/automation/extract";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { buildSearchQueries, tavilySearch } from "@/lib/automation/search";

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
  it("keeps one weak source private", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 1,
        directReportCount: 0,
        highestConfidence: "low",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("private");
  });

  it("promotes two independent sources", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 2,
        directReportCount: 0,
        highestConfidence: "medium",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("public");
  });

  it("direct report promotes a matching signal", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 1,
        directReportCount: 1,
        highestConfidence: "low",
        hasAdminForcePublic: false,
        hasAdminForceHidden: false,
      }).publicStatus,
    ).toBe("public");
  });

  it("admin force public promotes below-threshold signals", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 0,
        directReportCount: 0,
        highestConfidence: "low",
        hasAdminForcePublic: true,
        hasAdminForceHidden: false,
      }),
    ).toEqual({ publicStatus: "public", reason: "admin_force_public" });
  });

  it("force hidden wins over threshold", () => {
    expect(
      shouldPromoteSignalCluster({
        independentSourceCount: 3,
        directReportCount: 3,
        highestConfidence: "high",
        hasAdminForcePublic: true,
        hasAdminForceHidden: true,
      }).publicStatus,
    ).toBe("hidden");
  });
});

describe("search planning", () => {
  it("never emits more queries than the cap", () => {
    expect(buildSearchQueries(3)).toHaveLength(3);
    expect(buildSearchQueries(0)).toHaveLength(0);
  });

  it("caps query planning to the fixed query pack", () => {
    expect(buildSearchQueries(999)).toHaveLength(5);
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
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
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
});
