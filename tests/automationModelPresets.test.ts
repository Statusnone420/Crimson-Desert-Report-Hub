import { describe, expect, it, vi } from "vitest";
import { extractSignalWithOpenRouter, type OpenRouterExtractionOptions } from "@/lib/automation/extract";
import { mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";
import type { ScannerModelPreset } from "@/lib/automation/budget";

const candidate = { title: "Map crash", snippet: "The game closes when opening the map.", url: "https://example.com/map" };
const clusters = [{ id: "map", slug: "map-crash", title: "Map-open crash", category: "crash_startup" }];
const claim = { fixText: "Fixed a crash when opening the map.", category: "crash_startup" };
const extraction = {
  issueTitle: "Map-open crash", category: "crash_startup", platform: null, confidence: "high",
  summary: "The game closes when opening the map.", clusterAssignment: "sure",
  clusterReason: "The report names the map-open crash.", clusterSlug: "map-crash",
};
const mapping = { matchKind: "sure", clusterSlug: "map-crash", reason: "The claim names the map-open crash." };

function response(content: unknown, cost = 0.0001) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost } }) };
}

describe("saved scanner model presets", () => {
  const presets: { preset: ScannerModelPreset; model: string; inputPrice: number; outputPrice: number; tier?: string }[] = [
    { preset: "gpt_5_6_luna", model: "openai/gpt-5.6-luna", inputPrice: 0.2, outputPrice: 1.2 },
    { preset: "gpt_5_6_luna_flex", model: "openai/gpt-5.6-luna", inputPrice: 0.1, outputPrice: 0.6, tier: "flex" },
    { preset: "deepseek_v4_flash_rollback", model: "deepseek/deepseek-v4-flash", inputPrice: 0.2, outputPrice: 0.5 },
  ];

  for (const task of ["extraction", "claim_mapping"] as const) {
    it.each(presets)(`${task} uses saved $preset instead of an environment model`, async ({ preset, model, inputPrice, outputPrice, tier }) => {
      const fetcher = vi.fn(async (url: string, init: { body: string }) => {
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        const schemaName = JSON.parse(init.body).response_format.json_schema.name;
        return response(schemaName === "crimson_desert_issue_signal" ? extraction : mapping);
      });
      const options = {
        env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_AUTOMATION_MODEL: "unapproved/environment-model" },
        modelPreset: preset, llmCallsRemaining: 1, llmBudgetRemainingUsd: 1, fetcher,
      };
      const result = task === "extraction"
        ? await extractSignalWithOpenRouter(candidate, { ...options, clusterOptions: clusters })
        : await mapClaimToClusterWithOpenRouter(claim, clusters, options);
      expect(result.extractionModel).toBe(model);
      expect(result.llmCallsUsed).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const request = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(request.model).toBe(model);
      expect(request.service_tier).toBe(tier);
      expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
      expect(request.max_tokens).toBe(task === "extraction" ? 3_200 : 2_048);
      expect(request.provider).toMatchObject({
        require_parameters: true,
        max_price: { prompt: inputPrice, completion: outputPrice, request: 0, image: 0 },
      });
      if (model.startsWith("openai/")) {
        expect(request.provider).toMatchObject({ only: ["OpenAI"], allow_fallbacks: false, data_collection: "allow" });
        expect(request.reasoning).toEqual({ effort: "high", exclude: true });
        expect(request).not.toHaveProperty("temperature");
      } else {
        expect(request.provider).toMatchObject({ data_collection: "deny", zdr: true, sort: "price" });
        expect(request.reasoning).toEqual({ effort: "none" });
      }
    });

    it(`${task} reserves the selected tier's price before making a call`, async () => {
      const fetcher = vi.fn(async () => response(task === "extraction" ? extraction : mapping));
      const options = {
        env: { OPENROUTER_API_KEY: "test-key" }, llmCallsRemaining: 1,
        llmBudgetRemainingUsd: task === "extraction" ? 0.003 : 0.0018,
        fetcher,
      };
      const standardOptions = { ...options, modelPreset: "gpt_5_6_luna" as const };
      const standard = task === "extraction"
        ? await extractSignalWithOpenRouter(candidate, { ...standardOptions, clusterOptions: clusters })
        : await mapClaimToClusterWithOpenRouter(claim, clusters, standardOptions);
      expect(standard.llmCallsUsed).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      const flexOptions = { ...options, modelPreset: "gpt_5_6_luna_flex" as const };
      const flex = task === "extraction"
        ? await extractSignalWithOpenRouter(candidate, { ...flexOptions, clusterOptions: clusters })
        : await mapClaimToClusterWithOpenRouter(claim, clusters, flexOptions);
      expect(flex.llmCallsUsed).toBe(1);
      expect(flex.extractionModel).toBe("openai/gpt-5.6-luna");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }
});

describe("claim mapping failure diagnostics", () => {
  const options = { env: { OPENROUTER_API_KEY: "test-key" }, llmCallsRemaining: 1, llmBudgetRemainingUsd: 1 };

  it("records a provider failure whose cost is known", async () => {
    const result = await mapClaimToClusterWithOpenRouter(claim, clusters, {
      ...options,
      fetcher: async () => ({ ok: false, status: 503, json: async () => ({ usage: { cost: 0 } }) }),
    });
    expect(result).toMatchObject({ skipReason: "openrouter_provider_failure", llmCallsUsed: 1, llmCostUsd: 0 });
    expect(result.matchKind).not.toMatch(/^llm_/);
  });

  it.each([
    "{", null, "{}",
    JSON.stringify({ matchKind: "maybe", clusterSlug: null, reason: "Unclear." }),
    JSON.stringify({ matchKind: "unsure", reason: "Unclear." }),
    JSON.stringify({ matchKind: "unsure", clusterSlug: null, reason: "" }),
  ])("records invalid or missing model output: %j", async (content) => {
    const result = await mapClaimToClusterWithOpenRouter(claim, clusters, {
      ...options,
      fetcher: async () => ({
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content } }], usage: { cost: 0.0001 } }),
      }),
    });
    expect(result).toMatchObject({ skipReason: "openrouter_invalid_json", llmCallsUsed: 1, llmCostUsd: 0.0001 });
    expect(result.matchKind).not.toMatch(/^llm_/);
  });
});

describe("bounded model requests", () => {
  type Fetcher = NonNullable<OpenRouterExtractionOptions["fetcher"]>;
  for (const task of ["extraction", "claim_mapping"] as const) {
    const run = (fetcher: Fetcher, llmDeadlineAtMs?: number, llmBudgetRemainingUsd = 1) => {
      const options = {
        env: { OPENROUTER_API_KEY: "test-key" }, modelPreset: "gpt_5_6_luna_flex" as const,
        llmCallsRemaining: 3, llmBudgetRemainingUsd, llmDeadlineAtMs, fetcher,
      };
      return task === "extraction"
        ? extractSignalWithOpenRouter(candidate, { ...options, clusterOptions: clusters })
        : mapClaimToClusterWithOpenRouter(claim, clusters, options);
    };

    it(`${task} makes no call or reservation after the run deadline`, async () => {
      const fetcher = vi.fn(async () => response(task === "extraction" ? extraction : mapping));
      const result = await run(fetcher, Date.now() - 1);
      expect(result).toMatchObject({ llmCallsUsed: 0, llmCostUsd: 0 });
      expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
        .toBe("llm_time_limit");
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(["fetch", "body"])(`${task} bounds a stalled %s and never retries an unknown charge`, async (phase) => {
      vi.useFakeTimers();
      try {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn<Fetcher>(async (_url, init) => {
          signal = init.signal;
          if (phase === "fetch") return new Promise(() => {});
          return { ok: true, status: 200, json: () => new Promise(() => {}) };
        });
        const pending = run(fetcher);
        await vi.advanceTimersByTimeAsync(20_000);
        const result = await pending;
        expect(result.llmCallsUsed).toBe(1);
        expect(result.llmCostUsd).toBeGreaterThan(0);
        expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
          .toBe("openrouter_cost_unverified");
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`${task} shortens a request to the remaining run time`, async () => {
      vi.useFakeTimers();
      try {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn<Fetcher>(async (_url, init) => {
          signal = init.signal;
          return new Promise(() => {});
        });
        const pending = run(fetcher, Date.now() + 500);
        await vi.advanceTimersByTimeAsync(499);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(signal?.aborted).toBe(true);
        expect(result.llmCallsUsed).toBe(1);
        expect(result.llmCostUsd).toBeGreaterThan(0);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`${task} backs off after a verified-cost failure without changing the Flex route`, async () => {
      vi.useFakeTimers();
      try {
        const fetcher = vi.fn<Fetcher>()
          .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ usage: { cost: 0.0001 } }) })
          .mockResolvedValueOnce(response(task === "extraction" ? extraction : mapping));
        const pending = run(fetcher);
        await vi.advanceTimersByTimeAsync(99);
        expect(fetcher).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(result).toMatchObject({ llmCallsUsed: 2, llmCostUsd: 0.0002, extractionModel: "openai/gpt-5.6-luna" });
        for (const [, init] of fetcher.mock.calls) {
          expect(JSON.parse(init.body)).toMatchObject({ model: "openai/gpt-5.6-luna", service_tier: "flex" });
        }
        expect(fetcher).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([429, 503])(`${task} caps verified zero-cost HTTP %i retries at three`, async (status) => {
      vi.useFakeTimers();
      try {
        const fetcher = vi.fn<Fetcher>(async () => ({ ok: false, status, json: async () => ({ usage: { cost: 0 } }) }));
        const pending = run(fetcher);
        await vi.runAllTimersAsync();
        const result = await pending;
        expect(result).toMatchObject({ llmCallsUsed: 3, llmCostUsd: 0 });
        expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
          .toBe("openrouter_provider_failure");
        expect(fetcher).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`${task} does not assume an unaudited HTTP 429 was free`, async () => {
      const fetcher = vi.fn<Fetcher>(async () => ({ ok: false, status: 429, json: async () => ({ error: "rate limited" }) }));
      const result = await run(fetcher);
      expect(result.llmCallsUsed).toBe(1);
      expect(result.llmCostUsd).toBeGreaterThan(0);
      expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
        .toBe("openrouter_cost_unverified");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it(`${task} does not retry when the verified cost leaves too little for another reservation`, async () => {
      const fetcher = vi.fn<Fetcher>(async () => ({ ok: false, status: 503, json: async () => ({ usage: { cost: 0.001 } }) }));
      const result = await run(fetcher, undefined, task === "extraction" ? 0.003 : 0.0018);
      expect(result).toMatchObject({ llmCallsUsed: 1, llmCostUsd: 0.001 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it(`${task} bounds cost auditing by the run deadline without repeating inference`, async () => {
      vi.useFakeTimers();
      try {
        let auditSignal: AbortSignal | undefined;
        const fetcher = vi.fn<Fetcher>(async (url, init) => {
          if (url.includes("/generation?")) {
            auditSignal = init.signal;
            return new Promise(() => {});
          }
          return {
            ok: true, status: 200,
            json: async () => ({ id: "gen-test", choices: [{ message: { content: JSON.stringify(task === "extraction" ? extraction : mapping) } }] }),
          };
        });
        const pending = run(fetcher, Date.now() + 500);
        await vi.advanceTimersByTimeAsync(500);
        const result = await pending;
        expect(result.llmCallsUsed).toBe(1);
        expect(result.llmCostUsd).toBeGreaterThan(0);
        expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
          .toBe("openrouter_cost_unverified");
        expect(auditSignal?.aborted).toBe(true);
        expect(fetcher.mock.calls.filter(([url]) => url.includes("/chat/completions"))).toHaveLength(1);
        expect(fetcher.mock.calls.filter(([url]) => url.includes("/generation?"))).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`${task} stops if its deadline expires during retry backoff`, async () => {
      vi.useFakeTimers();
      try {
        const fetcher = vi.fn<Fetcher>(async () => ({ ok: false, status: 503, json: async () => ({ usage: { cost: 0.0001 } }) }));
        const pending = run(fetcher, Date.now() + 50);
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result).toMatchObject({ llmCallsUsed: 1, llmCostUsd: 0.0001 });
        expect("fallbackReason" in result ? result.fallbackReason : "skipReason" in result ? result.skipReason : null)
          .toBe("llm_time_limit");
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  }
});
