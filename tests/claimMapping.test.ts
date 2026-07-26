import { describe, expect, it, vi } from "vitest";
import { mapClaimToClusterWithOpenRouter, parseOpenRouterClaimMapping, type ClaimMappingCluster } from "@/lib/automation/claimMapping";

const clusters: ClaimMappingCluster[] = [
  {
    id: "cluster-fps",
    slug: "performance_regression",
    title: "FPS / performance regression",
    category: "performance",
    description: "Frame-rate drops and stutter after the patch.",
  },
  {
    id: "cluster-map",
    slug: "map_open_crash_persistent",
    title: "Map-open crash",
    category: "crash_startup",
    description: "Game crashes when opening the map.",
  },
];

describe("parseOpenRouterClaimMapping", () => {
  it("returns llm_sure only for a valid sure slug", () => {
    const result = parseOpenRouterClaimMapping(
      JSON.stringify({
        matchKind: "sure",
        clusterSlug: "performance_regression",
        reason: "The claim names frame-rate drops.",
      }),
      clusters,
      "performance",
    );

    expect(result).toMatchObject({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
    });
  });

  it("downgrades invalid sure slugs to llm_unsure", () => {
    const result = parseOpenRouterClaimMapping(
      JSON.stringify({
        matchKind: "sure",
        clusterSlug: "not-a-real-cluster",
        reason: "Bad slug.",
      }),
      clusters,
      "performance",
    );

    expect(result).toMatchObject({
      matchKind: "llm_unsure",
      clusterId: null,
      clusterSlug: null,
    });
  });

  it("downgrades a sure mapping when the claim and cluster categories differ", () => {
    const result = parseOpenRouterClaimMapping(
      JSON.stringify({
        matchKind: "sure",
        clusterSlug: "map_open_crash_persistent",
        reason: "The model selected the map crash cluster.",
      }),
      clusters,
      "performance",
    );

    expect(result).toMatchObject({
      matchKind: "llm_unsure",
      clusterId: "cluster-map",
      clusterSlug: "map_open_crash_persistent",
    });
  });
});

describe("mapClaimToClusterWithOpenRouter", () => {
  it("defaults to budget-capped DeepSeek V4 Flash", async () => {
    let requestedModel: string | null = null;
    let requestedProvider: unknown = null;
    let requestedReasoning: unknown = null;
    let requestedMaxTokens: number | null = null;
    let requestedSystemPrompt: string | null = null;
    const fetcher = async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as {
        model?: string;
        provider?: unknown;
        reasoning?: unknown;
        max_tokens?: number;
        messages?: { role?: string; content?: string }[];
      };
      requestedModel = body.model ?? null;
      requestedProvider = body.provider;
      requestedReasoning = body.reasoning;
      requestedMaxTokens = body.max_tokens ?? null;
      requestedSystemPrompt = body.messages?.find((message) => message.role === "system")?.content ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  matchKind: "sure",
                  clusterSlug: "performance_regression",
                  reason: "The claim names frame-rate drops.",
                }),
              },
            },
          ],
          usage: { cost: 0.00002 },
        }),
      };
    };

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(requestedModel).toBe("deepseek/deepseek-v4-flash");
    expect(requestedProvider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
      sort: "price",
      max_price: { prompt: 0.1, completion: 0.2, request: 0, image: 0 },
    });
    expect(requestedReasoning).toEqual({ effort: "none" });
    expect(requestedMaxTokens).toBe(200);
    expect(requestedSystemPrompt).toMatch(/untrusted data/i);
    expect(requestedSystemPrompt).toMatch(/ignore .*instructions/i);
    expect(result).toMatchObject({
      matchKind: "llm_sure",
      extractionModel: "deepseek/deepseek-v4-flash",
      llmCostUsd: 0.00002,
    });
  });

  it("uses OpenRouter when available and validates the returned cluster", async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matchKind: "sure",
                clusterSlug: "map_open_crash_persistent",
                reason: "The claim mentions map crashes.",
              }),
            },
          },
        ],
        usage: { cost: 0.00002 },
      }),
    });

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where opening the map caused a crash.", category: "crash_startup" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(result).toMatchObject({
      matchKind: "llm_sure",
      clusterId: "cluster-map",
      llmCallsUsed: 1,
      extractionModel: "deepseek/deepseek-v4-flash",
      llmCostUsd: 0.00002,
    });
  });

  it("audits missing immediate cost through the OpenRouter generation endpoint", async () => {
    const fetcher = vi.fn(async (url: string, _init: unknown) => {
      void _init;
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "gen-claim-123",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    matchKind: "sure",
                    clusterSlug: "performance_regression",
                    reason: "The claim names frame-rate drops.",
                  }),
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { total_cost: 0.00002 } }),
      };
    });

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(result).toMatchObject({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      llmCostUsd: 0.00002,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/generation?id=gen-claim-123");
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer key" },
    });
  });

  it("does not call OpenRouter when the configured automation model is not approved", async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      };
    };

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key", OPENROUTER_AUTOMATION_MODEL: "deepseek/deepseek-v4-pro" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(called).toBe(false);
    expect(result).toMatchObject({
      matchKind: "keyword_proposal",
      clusterId: "cluster-fps",
      extractionModel: null,
      llmCallsUsed: 0,
    });
  });

  it("accepts and accounts an authorized DeepSeek charge within budget", async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        usage: { cost: 0.00002 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                matchKind: "sure",
                clusterSlug: "performance_regression",
                reason: "The claim names frame-rate drops.",
              }),
            },
          },
        ],
      }),
    });

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(result).toMatchObject({
      matchKind: "llm_sure",
      clusterId: "cluster-fps",
      llmCallsUsed: 1,
      llmCostUsd: 0.00002,
      extractionModel: "deepseek/deepseek-v4-flash",
    });
  });

  it("opens the circuit when a paid response omits cost metadata", async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key" },
        fetcher,
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 1,
      },
    );

    expect(result).toMatchObject({
      matchKind: "keyword_proposal",
      llmCallsUsed: 1,
      circuitReason: "openrouter_cost_unverified",
    });
    // Unverifiable cost is charged at the request's worst-case ceiling.
    expect(result.llmCostUsd).toBeGreaterThan(0);
    expect(result.llmCostUsd).toBeLessThan(0.01);
  });

  it("falls back to keyword proposal only when OpenRouter is unavailable", async () => {
    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" },
      clusters,
      { env: {}, llmCallsRemaining: 1 },
    );

    expect(result).toMatchObject({
      matchKind: "keyword_proposal",
      clusterId: "cluster-fps",
      clusterSlug: "performance_regression",
      llmCallsUsed: 0,
    });
  });

  it("returns none when fallback routing has no category", async () => {
    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Improved UI polish.", category: null },
      clusters,
      { env: {}, llmCallsRemaining: 1 },
    );

    expect(result).toMatchObject({
      matchKind: "none",
      clusterId: null,
    });
  });
});
