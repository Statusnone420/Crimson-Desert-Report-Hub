import { afterEach, describe, expect, it, vi } from "vitest";
import { extractSignalWithOpenRouter, type OpenRouterExtractionOptions } from "@/lib/automation/extract";
import { mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";
import type { OpenRouterDiagnostic, OpenRouterDiagnosticReporter } from "@/lib/automation/openRouterDiagnostics";

type Fetcher = NonNullable<OpenRouterExtractionOptions["fetcher"]>;
const privateMarker = "PRIVATE-fixture-source-and-key-never-record";
const options = {
  env: { OPENROUTER_API_KEY: privateMarker },
  llmCallsRemaining: 1,
  llmBudgetRemainingUsd: 1,
};
const candidate = { title: "Crimson Desert map crash", snippet: privateMarker, url: `https://example.test/${privateMarker}` };
const cluster = { id: privateMarker, slug: "map_open_crash_persistent", title: "Map-open crash", category: "crash_startup" };
const lanes = [
  {
    name: "extraction",
    content: JSON.stringify({ issueTitle: "Map crash", category: "crash_startup", platform: "pc_steam", confidence: "medium",
      summary: "Crimson Desert crashes when opening the map.", clusterAssignment: "unsure", clusterReason: "Uncertain", clusterSlug: null }),
    run: async (fetcher: Fetcher, onDiagnostic: OpenRouterDiagnosticReporter, deadline?: number) => {
      const result = await extractSignalWithOpenRouter(candidate, { ...options, fetcher, onDiagnostic, llmDeadlineAtMs: deadline });
      return { reason: result.fallbackReason, validated: result.extractionProvider === "openrouter", calls: result.llmCallsUsed, cost: result.llmCostUsd };
    },
  },
  {
    name: "claim mapping",
    content: JSON.stringify({ matchKind: "sure", clusterSlug: cluster.slug, reason: "The official fix names map crashes." }),
    run: async (fetcher: Fetcher, onDiagnostic: OpenRouterDiagnosticReporter, deadline?: number) => {
      const result = await mapClaimToClusterWithOpenRouter({ fixText: privateMarker, category: "crash_startup" }, [cluster],
        { ...options, fetcher, onDiagnostic, llmDeadlineAtMs: deadline });
      return { reason: result.skipReason, validated: result.matchKind === "llm_sure" || result.matchKind === "llm_unsure", calls: result.llmCallsUsed, cost: result.llmCostUsd };
    },
  },
];

afterEach(() => vi.useRealTimers());

for (const lane of lanes) describe(`${lane.name} private diagnostics`, () => {
  it.each(["transport", "decode"] as const)("distinguishes %s failures without retaining the exception", async (failure) => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn(async () => {
      if (failure === "transport") throw new TypeError(privateMarker);
      return { ok: true, status: 200, json: async () => { throw new SyntaxError(privateMarker); } };
    });
    const result = await lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic));
    expect(result).toMatchObject({ reason: "openrouter_cost_unverified", validated: false, calls: 1 });
    expect(result.cost).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([{ code: failure === "transport" ? "request_transport_failure" : "response_decode_failure",
      elapsedMs: expect.any(Number), httpStatus: failure === "transport" ? null : 200, attempts: 1 }]);
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it.each(["request", "body"] as const)("identifies a stalled %s without treating it as an uncharged attempt", async (stage) => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn<Fetcher>(async (_url, init) => {
      const stalled = () => new Promise<never>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error(privateMarker)), { once: true });
      });
      return stage === "request" ? stalled() : { ok: true, status: 200, json: stalled };
    });
    const pending = lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic));
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result).toMatchObject({ reason: "openrouter_cost_unverified", validated: false, calls: 1 });
    expect(result.cost).toBeGreaterThan(0);
    expect(diagnostics).toEqual([{ code: "request_timeout", elapsedMs: 20_000, httpStatus: stage === "body" ? 200 : null, attempts: 1 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("separates missing response cost/ID from a failed generation lookup", async () => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: lane.content } }] }) }));
    const result = await lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic));
    expect(result).toMatchObject({ reason: "openrouter_cost_unverified", validated: false });
    expect(result.cost).toBeGreaterThan(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["response_cost_missing", "response_id_missing"]);
    expect(diagnostics.every((diagnostic) => diagnostic.httpStatus === 200)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("records generation lookup failure while retaining the conservative reserve", async () => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn<Fetcher>(async (url) => url.includes("/generation")
      ? { ok: false, status: 503, json: async () => ({ privateMarker }) }
      : { ok: true, status: 200, json: async () => ({ id: privateMarker, choices: [{ message: { content: lane.content } }] }) });
    const pending = lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic));
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result).toMatchObject({ reason: "openrouter_cost_unverified", validated: false, calls: 1 });
    expect(result.cost).toBeGreaterThan(0);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "generation_lookup_http_failure", httpStatus: 503, attempts: 3 }));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it("keeps a recovered cost lookup and a validated answer healthy", async () => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    let lookups = 0;
    const fetcher = vi.fn<Fetcher>(async (url) => {
      if (!url.includes("/generation")) return { ok: true, status: 200, json: async () => ({ id: privateMarker, choices: [{ message: { content: lane.content } }] }) };
      lookups += 1;
      return lookups === 1 ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ data: { total_cost: 0.00001 } }) };
    });
    const pending = lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ reason: undefined, validated: true, calls: 1, cost: 0.00001 });
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "generation_lookup_verified", attempts: 2, httpStatus: 200 }));
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it("does not confuse decoded but invalid model content with an unknown cost", async () => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const result = await lane.run(async () => ({ ok: true, status: 200, json: async () => ({ usage: { cost: 0 }, choices: [{ message: { content: privateMarker } }] }) }),
      (diagnostic) => diagnostics.push(diagnostic));
    expect(result).toEqual({ reason: "openrouter_invalid_json", validated: false, calls: 1, cost: 0 });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "response_validation_failure", httpStatus: 200, attempts: 1 })]);
    expect(JSON.stringify(diagnostics)).not.toContain(privateMarker);
  });

  it("starts no request after the scan deadline", async () => {
    const fetcher = vi.fn();
    const diagnostics: OpenRouterDiagnostic[] = [];
    expect(await lane.run(fetcher, (diagnostic) => diagnostics.push(diagnostic), Date.now() - 1))
      .toMatchObject({ reason: "llm_time_limit", calls: 0, cost: 0, validated: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([]);
  });

  for (const sink of ["throws", "rejects"] as const) {
    it.each(["transport", "validation", "lookup"] as const)(`keeps the real %s outcome when telemetry ${sink}`, async (scenario) => {
      const reporter = vi.fn(sink === "throws"
        ? () => { throw new Error(privateMarker); }
        : async () => { throw new Error(privateMarker); });
      const fetcher = vi.fn<Fetcher>(async (url) => {
        if (scenario === "transport") throw new Error("transport failure");
        if (url.includes("/generation")) return { ok: true, status: 200, json: async () => ({ data: { total_cost: 0.00001 } }) };
        return { ok: true, status: 200, json: async () => scenario === "validation"
          ? { usage: { cost: 0 }, choices: [{ message: { content: "invalid model content" } }] }
          : { id: privateMarker, choices: [{ message: { content: lane.content } }] } };
      });
      const result = await lane.run(fetcher, reporter);
      expect(reporter).toHaveBeenCalled();
      expect(result.calls).toBe(1);
      if (scenario === "transport") {
        expect(result).toMatchObject({ reason: "openrouter_cost_unverified", validated: false });
        expect(result.cost).toBeGreaterThan(0);
      } else if (scenario === "validation") {
        expect(result).toEqual({ reason: "openrouter_invalid_json", validated: false, calls: 1, cost: 0 });
      } else {
        expect(result).toEqual({ reason: undefined, validated: true, calls: 1, cost: 0.00001 });
      }
    });
  }
});
