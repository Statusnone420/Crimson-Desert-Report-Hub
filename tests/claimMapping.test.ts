import { describe, expect, it } from "vitest";
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
    );

    expect(result).toMatchObject({
      matchKind: "llm_unsure",
      clusterId: null,
      clusterSlug: null,
    });
  });
});

describe("mapClaimToClusterWithOpenRouter", () => {
  it("defaults to the documented free OpenRouter route", async () => {
    let requestedModel: string | null = null;
    const fetcher = async (_url: string, init: { body: string }) => {
      requestedModel = (JSON.parse(init.body) as { model?: string }).model ?? null;
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
      },
    );

    expect(requestedModel).toBe("openrouter/free");
    expect(result).toMatchObject({
      matchKind: "llm_sure",
      extractionModel: "openrouter/free",
      llmCostUsd: 0,
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
      }),
    });

    const result = await mapClaimToClusterWithOpenRouter(
      { fixText: "Fixed an issue where opening the map caused a crash.", category: "crash_startup" },
      clusters,
      {
        env: { OPENROUTER_API_KEY: "key", OPENROUTER_FREE_MODEL: "openrouter/free" },
        fetcher,
        llmCallsRemaining: 1,
      },
    );

    expect(result).toMatchObject({
      matchKind: "llm_sure",
      clusterId: "cluster-map",
      llmCallsUsed: 1,
      extractionModel: "openrouter/free",
      llmCostUsd: 0,
    });
  });

  it("does not call OpenRouter when the configured claim model is not free", async () => {
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
        env: { OPENROUTER_API_KEY: "key", OPENROUTER_FREE_MODEL: "deepseek/deepseek-v4-flash" },
        fetcher,
        llmCallsRemaining: 1,
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
