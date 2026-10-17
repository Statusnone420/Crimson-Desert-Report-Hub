import { describe, expect, it, vi } from "vitest";
import type { AiProfile } from "@/lib/aiSettings/types";
import { automationModelSettings, computeAutomationBudget, maxOpenRouterRequestCostUsd, openRouterRequestFitsContext, resolveAutomationOpenRouterModel } from "@/lib/automation/budget";
import { extractionRequest, extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { claimMappingRequest, claimMappingRequestBody, mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";
import { mappingFingerprint } from "@/lib/automation/mappingCache.server";

const profile: AiProfile = {
  provider: "openrouter", modelId: "fixture/dynamic", connectionVersion: 3, reasoning: "default", retention: "standard", maxOutputTokens: 1_024,
  metadata: { provider: "openrouter", id: "fixture/dynamic", name: "Dynamic model", contextWindow: 32_768, maxOutputTokens: 8_192,
    inputModalities: ["text"], outputModalities: ["text"], supportedParameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"],
    reasoning: true, reasoningEfforts: ["none", "low", "medium", "high"], reasoningRequired: false, structuredOutput: true,
    inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, pricingSource: "provider", pricingSupported: true, pricingIssue: null, fetchedAt: "2026-10-02T10:00:00.000Z" },
};
const candidate = { title: "Map crash", snippet: "The game closes when opening the map.", url: "https://example.com/map" };
const claim = { fixText: "Fixed a crash opening the map.", category: "crash_startup" };
const clusters = [{ id: "map", slug: "map-crash", title: "Map crash", category: "crash_startup" }];
const patch = { version: "1.13", publishedAt: "2026-07-01T00:00:00.000Z" };
const extraction = { issueTitle: "Map crash", category: "crash_startup", platform: null, confidence: "high", summary: "Map crashes.",
  clusterAssignment: "sure", clusterReason: "Same crash", clusterSlug: "map-crash" };
const mapping = { matchKind: "sure", clusterSlug: "map-crash", reason: "Same crash" };

describe("validated dashboard model profiles", () => {
  it("overrides a legacy preset without inheriting its pricing, temperature, reasoning, or retention", () => {
    expect(resolveAutomationOpenRouterModel("legacy/model", "gpt_5_6_luna_flex", profile)).toBe(profile.modelId);
    for (const request of [extractionRequest(candidate, profile.modelId, clusters, "gpt_5_6_luna_flex", profile),
      claimMappingRequest(claim, clusters, profile.modelId, "gpt_5_6_luna_flex", profile)]) {
      expect(request).toMatchObject({ model: profile.modelId, max_tokens: 1_024, provider: {
        require_parameters: true, data_collection: "allow", max_price: { prompt: 0.2, completion: 1.2, request: 0, image: 0 } } });
      expect(request).not.toHaveProperty("reasoning");
      expect(request).not.toHaveProperty("temperature");
      expect(request).not.toHaveProperty("service_tier");
      expect(request.provider).not.toHaveProperty("zdr");
      expect(request.modalities).toEqual(["text"]);
      expect(request.plugins).toContainEqual({ id: "web", enabled: false });
      expect(request.plugins).toContainEqual({ id: "context-compression", enabled: false });
    }
  });
  it("retains task ceilings and budgets reasoning as part of total output", () => {
    const large = { ...profile, reasoning: "high" as const, retention: "zdr" as const, maxOutputTokens: 8_192 };
    const request = extractionRequest(candidate, profile.modelId, clusters, undefined, large);
    expect(request).toHaveProperty("max_tokens", 3_200);
    expect(claimMappingRequest(claim, clusters, profile.modelId, undefined, large)).toHaveProperty("max_tokens", 2_048);
    expect(request.reasoning).toEqual({ effort: "high", exclude: true });
    expect(request.provider).toMatchObject({ require_parameters: true, data_collection: "deny", zdr: true });
    expect(maxOpenRouterRequestCostUsd("é", 3_200, profile.modelId, undefined, profile)).toBe((2 * 0.2 + 1_024 * 1.2) / 1_000_000);
  });
  it("pins both scanner tasks to the tested provider and its own prices without changing legacy profiles", () => {
    const selected = { ...profile, metadata: { ...profile.metadata, inputUsdPerMillion: 0.021, outputUsdPerMillion: 0.383,
      endpoint: { name: "Compatible provider", tag: "compatible/fp8", maxPromptTokens: 24_000 } } };
    for (const request of [extractionRequest(candidate, profile.modelId, clusters, undefined, selected),
      claimMappingRequest(claim, clusters, profile.modelId, undefined, selected)]) {
      expect(request.provider).toMatchObject({ only: ["compatible/fp8"], allow_fallbacks: false, require_parameters: true,
        max_price: { prompt: 0.021, completion: 0.383, request: 0, image: 0 } });
    }
    expect(automationModelSettings(profile.modelId, undefined, profile).provider).not.toHaveProperty("only");
    expect(maxOpenRouterRequestCostUsd("test", 3200, profile.modelId, undefined, selected)).toBe((4 * 0.021 + 1024 * 0.383) / 1_000_000);
    const smallPrompt = { ...selected, metadata: { ...selected.metadata, endpoint: { ...selected.metadata.endpoint, maxPromptTokens: 2 } } };
    expect(openRouterRequestFitsContext("é", 3200, smallPrompt)).toBe(true);
    expect(openRouterRequestFitsContext("é!", 3200, smallPrompt)).toBe(false);
  });
  it("uses only an advertised output-limit key", () => {
    const alternate = { ...profile, metadata: { ...profile.metadata,
      supportedParameters: ["max_completion_tokens", "response_format", "structured_outputs", "reasoning"] } };
    const request = extractionRequest(candidate, profile.modelId, clusters, undefined, alternate);
    expect(request).toHaveProperty("max_completion_tokens", 1_024);
    expect(request).not.toHaveProperty("max_tokens");
  });
  it.each([
    { ...profile, metadata: { ...profile.metadata, inputUsdPerMillion: null } },
    { ...profile, metadata: { ...profile.metadata, pricingSupported: false, pricingIssue: "additional_charges" as const } },
    { ...profile, metadata: { ...profile.metadata, pricingSupported: true, pricingIssue: "tiered_pricing" as const } },
    { ...profile, metadata: { ...profile.metadata, inputUsdPerMillion: NaN } },
    { ...profile, metadata: { ...profile.metadata, outputUsdPerMillion: -1 } },
    { ...profile, metadata: { ...profile.metadata, structuredOutput: false } },
    { ...profile, metadata: { ...profile.metadata, supportedParameters: ["response_format", "structured_outputs"] } },
    { ...profile, metadata: { ...profile.metadata, supportedParameters: null } },
    { ...profile, metadata: { ...profile.metadata, inputModalities: ["image"] } },
    { ...profile, metadata: { ...profile.metadata, outputModalities: ["image"] } },
    { ...profile, metadata: { ...profile.metadata, id: "different/model" } },
    { ...profile, maxOutputTokens: 9_000 },
    { ...profile, reasoning: "none" as const, metadata: { ...profile.metadata, reasoningRequired: true } },
    { ...profile, reasoning: "high" as const, metadata: { ...profile.metadata, reasoningEfforts: ["low"] } },
  ])("blocks unsupported profiles before either task dispatches", async (configuredModel) => {
    expect(() => automationModelSettings(profile.modelId, undefined, configuredModel)).toThrow();
    const fetcher = vi.fn();
    const options = { configuredModel, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 };
    expect((await extractSignalWithOpenRouter(candidate, options)).llmCallsUsed).toBe(0);
    expect((await mapClaimToClusterWithOpenRouter(claim, clusters, options)).llmCallsUsed).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const task of ["extraction", "claim_mapping"] as const) {
    const dispatch = (options: Parameters<typeof extractSignalWithOpenRouter>[1]) => task === "extraction"
      ? extractSignalWithOpenRouter(candidate, { ...options, clusterOptions: clusters }) : mapClaimToClusterWithOpenRouter(claim, clusters, options);
    it.each([null, 1_024])(`${task} rejects unknown or insufficient context before reservation`, async (contextWindow) => {
      const fetcher = vi.fn();
      const begin = vi.fn();
      const result = await dispatch({ configuredModel: { ...profile, metadata: { ...profile.metadata, contextWindow } },
        apiKey: "fixture-key", fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1,
        paidGuard: { deadlineAtMs: Date.now() + 60_000, begin } });
      expect(result).toMatchObject({ llmCallsUsed: 0, llmCostUsd: 0 });
      expect(result).toMatchObject(task === "extraction" ? { fallbackReason: "openrouter_context_limit" } : { skipReason: "openrouter_context_limit" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(begin).not.toHaveBeenCalled();
    });
    it(`${task} uses a resolved server credential and accepts verified free output`, async () => {
      const free = { ...profile, metadata: { ...profile.metadata, inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };
      const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0 },
        choices: [{ message: { content: JSON.stringify(task === "extraction" ? extraction : mapping) } }] }) }));
      const result = await dispatch({ configuredModel: free, apiKey: "resolved-key", env: { OPENROUTER_API_KEY: "other-key" },
        fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd: 0 });
      expect(result).toMatchObject({ extractionModel: profile.modelId, llmCallsUsed: 1, llmCostUsd: 0 });
      const init = vi.mocked(fetcher).mock.calls[0] as unknown[];
      expect(init[1]).toMatchObject({ headers: { authorization: "Bearer resolved-key" }, redirect: "error" });
      expect(JSON.stringify(result)).not.toMatch(/resolved-key|other-key/);
    });
    it.each([400, 401, 429, 503])(`${task} never retries HTTP %i within a managed run`, async (status) => {
      const fetcher = vi.fn(async () => ({ ok: false, status, json: async () => ({ usage: { cost: 0 } }) }));
      const result = await dispatch({ configuredModel: profile, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 });
      expect(result.llmCallsUsed).toBe(1);
      expect(fetcher).toHaveBeenCalledOnce();
    });
    it(`${task} preserves the worst-case reserve when response cost is unknown`, async () => {
      const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
      const result = await dispatch({ configuredModel: profile, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 });
      expect(result.llmCallsUsed).toBe(1);
      expect(result.llmCostUsd).toBeGreaterThan(0);
      expect(fetcher).toHaveBeenCalledOnce();
    });
  }
  const pinned = { ...profile, metadata: { ...profile.metadata, inputUsdPerMillion: 0.026, outputUsdPerMillion: 0.377,
    endpoint: { name: "Pinned provider", tag: "pinned/fp8", maxPromptTokens: null } } };
  for (const task of ["extraction", "claim_mapping"] as const) {
    const run = async (llmBudgetRemainingUsd: number) => {
      const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0.0001 },
        choices: [{ message: { content: JSON.stringify(task === "extraction" ? extraction : mapping) } }] }) }));
      const begin = vi.fn();
      const options = { configuredModel: pinned, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3, llmBudgetRemainingUsd,
        paidGuard: { deadlineAtMs: Date.now() + 60_000, begin } };
      const result = task === "extraction"
        ? await extractSignalWithOpenRouter(candidate, { ...options, clusterOptions: clusters })
        : await mapClaimToClusterWithOpenRouter(claim, clusters, options);
      const calls = fetcher.mock.calls as unknown as [string, { body: string }][];
      const body = calls[0] ? JSON.parse(calls[0][1].body) : null;
      return { result, body, ceiling: begin.mock.calls[0]?.[2] as number | undefined };
    };
    it(`${task} lets the pinned provider charge up to 4x the saved quote within the request limit`, async () => {
      const { result, body, ceiling } = await run(0.01);
      expect(result.llmCallsUsed).toBe(1);
      expect(body.provider).toMatchObject({ only: ["pinned/fp8"], allow_fallbacks: false,
        max_price: { prompt: 0.104, completion: 1.508, request: 0, image: 0 } });
      expect(ceiling).toBeLessThanOrEqual(0.01);
    });
    it(`${task} shrinks the headroom to fit a tight limit and never goes below the quote`, async () => {
      const quoted = (await run(1e-9)).result;
      expect(quoted.llmCallsUsed).toBe(0);
      const quotedCeiling = (await run(1)).ceiling! / 4;
      const tight = await run(quotedCeiling * 2);
      expect(tight.body.provider.max_price.prompt).toBeGreaterThan(0.026);
      expect(tight.body.provider.max_price.prompt).toBeLessThan(0.104);
      expect(tight.ceiling).toBeLessThanOrEqual(quotedCeiling * 2);
    });
  }
  it("keeps an unpinned profile at the saved quote so pricier providers stay excluded", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0.0001 },
      choices: [{ message: { content: JSON.stringify(extraction) } }] }) }));
    await extractSignalWithOpenRouter(candidate, { configuredModel: profile, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3,
      llmBudgetRemainingUsd: 1, clusterOptions: clusters });
    await mapClaimToClusterWithOpenRouter(claim, clusters, { configuredModel: profile, apiKey: "fixture-key", fetcher, llmCallsRemaining: 3,
      llmBudgetRemainingUsd: 1 });
    for (const [, init] of fetcher.mock.calls as unknown as [string, { body: string }][]) {
      expect(JSON.parse(init.body).provider.max_price).toMatchObject({ prompt: 0.2, completion: 1.2 });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps setup tests, request builders and the mapping cache key at the saved quote", () => {
    expect(extractionRequest(candidate, profile.modelId, clusters, undefined, pinned).provider.max_price).toMatchObject({ prompt: 0.026, completion: 0.377 });
    expect(JSON.parse(claimMappingRequestBody(claim, clusters, undefined, {}, pinned)).provider.max_price).toMatchObject({ prompt: 0.026, completion: 0.377 });
    expect(() => automationModelSettings(profile.modelId, undefined, pinned, 4.01)).toThrow();
    expect(() => automationModelSettings(profile.modelId, undefined, pinned, 0.5)).toThrow();
  });
  it("checks schema bytes plus the whole completion ceiling at the context boundary", () => {
    const exact = { ...profile, metadata: { ...profile.metadata, contextWindow: 1_026 } };
    expect(openRouterRequestFitsContext("é", 3_200, exact)).toBe(true);
    expect(openRouterRequestFitsContext("é!", 3_200, exact)).toBe(false);
    expect(openRouterRequestFitsContext("é", 3_200)).toBe(true);
  });
  it("invalidates cached mappings for every profile field and credential version without hashing the credential", () => {
    const options = { configuredModel: profile, llmCallsRemaining: 1 };
    const fingerprint = mappingFingerprint(claim, clusters, patch, options);
    for (const configuredModel of [{ ...profile, connectionVersion: 4 }, { ...profile, maxOutputTokens: 1_025 },
      { ...profile, reasoning: "high" as const }, { ...profile, retention: "zdr" as const },
      { ...profile, metadata: { ...profile.metadata, fetchedAt: "2026-10-02T11:00:00.000Z" } }]) {
      expect(mappingFingerprint(claim, clusters, patch, { ...options, configuredModel })).not.toBe(fingerprint);
    }
    expect(mappingFingerprint(claim, clusters, patch, { ...options, apiKey: "secret" })).toBe(fingerprint);
  });
  it("raises the monthly limit only for an explicitly managed policy", () => {
    const input = { monthlyBudgetUsd: 0, spentMonthToDateUsd: 0, now: new Date("2026-10-02T00:00:00.000Z") };
    expect(computeAutomationBudget({ ...input, scannerPolicy: { monthlyLlmUsdCap: 50 } }).monthlyLlmUsdCap).toBe(1);
    expect(computeAutomationBudget({ ...input, scannerPolicy: { monthlyLlmUsdCap: 50, aiManaged: true } }).monthlyLlmUsdCap).toBe(50);
    expect(computeAutomationBudget({ ...input, scannerPolicy: { monthlyLlmUsdCap: 2_000, aiManaged: true } }).monthlyLlmUsdCap).toBe(1_000);
  });
});
