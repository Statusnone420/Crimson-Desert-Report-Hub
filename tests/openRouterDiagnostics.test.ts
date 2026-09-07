import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendOpenRouterDiagnostics,
  createOpenRouterDiagnostic,
  type OpenRouterDiagnostic,
} from "@/lib/automation/openRouterDiagnostics";
import { resolveOpenRouterCostUsd, type OpenRouterGenerationFetcher } from "@/lib/automation/budget";

afterEach(() => vi.useRealTimers());

function generationFetcher(
  handler: (attempt: number) => ReturnType<OpenRouterGenerationFetcher>,
): OpenRouterGenerationFetcher {
  let attempts = 0;
  return (url, init) => {
    expect(url).toMatch(/^https:\/\/openrouter\.ai\/api\/v1\/generation\?id=/);
    expect(init.method).toBe("GET");
    attempts += 1;
    return handler(attempts);
  };
}

describe("OpenRouter cost diagnostics", () => {
  it("reports a shared deadline before generation lookup begins", async () => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn<OpenRouterGenerationFetcher>();

    await expect(resolveOpenRouterCostUsd({ id: "gen-test" }, "key", fetcher, Date.now() - 1, (item) => diagnostics.push(item)))
      .resolves.toBeNull();

    expect(fetcher).not.toHaveBeenCalled();
    expect(diagnostics.map((item) => item.code)).toEqual(["response_cost_missing", "generation_lookup_deadline"]);
    expect(diagnostics.at(-1)).toMatchObject({ httpStatus: null, attempts: 0 });
  });

  it("reports a bounded generation timeout without retaining request data", async () => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    const pending = resolveOpenRouterCostUsd(
      { id: "gen-test" },
      "key",
      generationFetcher(() => new Promise(() => {})),
      undefined,
      (item) => diagnostics.push(item),
    );

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBeNull();
    expect(diagnostics.map((item) => item.code)).toEqual([
      "response_cost_missing",
      "generation_lookup_timeout",
      "generation_lookup_timeout",
      "generation_lookup_timeout",
    ]);
    expect(diagnostics.at(-1)).toMatchObject({ attempts: 3, httpStatus: null, elapsedMs: 6_350 });
  });

  it.each([
    ["malformed JSON", () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }), "generation_lookup_decode_failure"],
    ["transport exception", () => { throw new Error("network down"); }, "generation_lookup_transport_failure"],
  ] as const)("distinguishes %s from missing cost", async (_label, response, expected) => {
    const diagnostics: OpenRouterDiagnostic[] = [];
    const deadlineAtMs = Date.now() + 1;

    await expect(resolveOpenRouterCostUsd(
      { id: "gen-test" },
      "key",
      generationFetcher(() => Promise.resolve(response())),
      deadlineAtMs,
      (item) => diagnostics.push(item),
    )).resolves.toBeNull();

    expect(diagnostics.map((item) => item.code)).toContain(expected);
    expect(diagnostics.map((item) => item.code)).toContain("generation_lookup_deadline");
  });

  it("retries a 404 and records the verified generation cost", async () => {
    vi.useFakeTimers();
    const diagnostics: OpenRouterDiagnostic[] = [];
    const pending = resolveOpenRouterCostUsd(
      { id: "gen-test" },
      "key",
      generationFetcher((attempt) => Promise.resolve(attempt === 1
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ data: { total_cost: 0.0002 } }) })),
      undefined,
      (item) => diagnostics.push(item),
    );

    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(0.0002);
    expect(diagnostics.map((item) => item.code)).toEqual([
      "response_cost_missing",
      "generation_lookup_http_failure",
      "generation_lookup_verified",
    ]);
    expect(diagnostics.at(-1)).toMatchObject({ httpStatus: 200, attempts: 2 });
  });

  it("reports persistent HTTP failure and exhausted missing-cost lookup", async () => {
    vi.useFakeTimers();
    const httpDiagnostics: OpenRouterDiagnostic[] = [];
    const httpPending = resolveOpenRouterCostUsd(
      { id: "gen-test" },
      "key",
      generationFetcher(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) })),
      undefined,
      (item) => httpDiagnostics.push(item),
    );
    await vi.runAllTimersAsync();
    await expect(httpPending).resolves.toBeNull();
    expect(httpDiagnostics.filter((item) => item.code === "generation_lookup_http_failure")).toHaveLength(3);

    const costDiagnostics: OpenRouterDiagnostic[] = [];
    const costPending = resolveOpenRouterCostUsd(
      { id: "gen-test" },
      "key",
      generationFetcher(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ data: {} }) })),
      undefined,
      (item) => costDiagnostics.push(item),
    );
    await vi.runAllTimersAsync();
    await expect(costPending).resolves.toBeNull();
    expect(costDiagnostics.filter((item) => item.code === "generation_lookup_cost_missing")).toHaveLength(3);
  });

  it("records missing IDs and accepts an explicit zero cost without a lookup", async () => {
    const missingIdDiagnostics: OpenRouterDiagnostic[] = [];
    await expect(resolveOpenRouterCostUsd({}, "key", vi.fn<OpenRouterGenerationFetcher>(), undefined, (item) => missingIdDiagnostics.push(item)))
      .resolves.toBeNull();
    expect(missingIdDiagnostics.map((item) => item.code)).toEqual(["response_cost_missing", "response_id_missing"]);

    const verifiedDiagnostics: OpenRouterDiagnostic[] = [];
    const fetcher = vi.fn<OpenRouterGenerationFetcher>();
    await expect(resolveOpenRouterCostUsd({ usage: { cost: 0 } }, "key", fetcher, undefined, (item) => verifiedDiagnostics.push(item)))
      .resolves.toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(verifiedDiagnostics).toEqual([]);
  });

  it("bounds and reconstructs diagnostics without preserving extra payload fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
    const bounded = createOpenRouterDiagnostic("request_timeout", Date.now() - 200_000, 700, 9);
    expect(bounded).toEqual({ code: "request_timeout", elapsedMs: 180_000, httpStatus: null, attempts: 3 });

    const polluted = {
      code: "generation_lookup_verified",
      elapsedMs: 5,
      httpStatus: 200,
      attempts: 1,
      privatePayload: "must-not-survive",
    } as unknown as OpenRouterDiagnostic;
    const invalid = { code: "not_allowed", elapsedMs: 1, httpStatus: 200, attempts: 1 } as unknown as OpenRouterDiagnostic;
    const many = Array.from({ length: 40 }, (_, index) => createOpenRouterDiagnostic("request_http_failure", Date.now() - index, 503, 1));
    const result = appendOpenRouterDiagnostics([polluted, invalid], many);

    expect(result).toHaveLength(32);
    expect(result.every((item) => Object.keys(item).sort().join(",") === "attempts,code,elapsedMs,httpStatus")).toBe(true);
    expect(result.some((item) => "privatePayload" in item)).toBe(false);
  });
});
