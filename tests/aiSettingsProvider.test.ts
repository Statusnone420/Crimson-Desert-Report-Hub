import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOpenRouterConnection, inspectOpenRouterEndpoints, inspectOpenRouterModel, listOpenRouterModels } from "@/lib/aiSettings/provider.server";

function model(overrides: Record<string, unknown> = {}) {
  return { id: "fixture/text-model", name: "Fixture text model", context_length: 32_768,
    top_provider: { max_completion_tokens: 8_192 }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000002", completion: "0.0000012" },
    supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning"],
    reasoning: { supported_efforts: ["none", "low", "high"], mandatory: false }, ...overrides };
}
const catalog = (rows: unknown[]) => vi.fn<typeof fetch>(async () => Response.json({ data: rows }));

afterEach(() => vi.useRealTimers());

describe("OpenRouter metadata boundary", () => {
  it("reads the live fixed catalog with a private key and preserves exact capabilities", async () => {
    const fetcher = catalog([model()]);
    const result = await inspectOpenRouterModel("fixture/text-model", "fixture-key", fetcher);
    expect(result).toMatchObject({ provider: "openrouter", id: "fixture/text-model", contextWindow: 32_768, maxOutputTokens: 8_192,
      inputModalities: ["text", "image"], outputModalities: ["text"], reasoning: true, structuredOutput: true,
      reasoningEfforts: ["none", "low", "high"], reasoningRequired: false,
      inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, pricingSource: "provider" });
    expect(fetcher).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", expect.objectContaining({
      method: "GET", headers: { authorization: "Bearer fixture-key" }, redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(result)).not.toContain("fixture-key");
  });
  it("requires an exact ID, including variant suffix and case", async () => {
    for (const id of ["Fixture/text-model", "text-model", "fixture/text-model:free", "https://attacker.invalid/model"]) {
      const fetcher = catalog([model()]);
      await expect(inspectOpenRouterModel(id, "fixture-key", fetcher)).rejects.toMatchObject({ code: "model_not_found" });
      expect(fetcher.mock.calls.every(([url]) => url === "https://openrouter.ai/api/v1/models")).toBe(true);
    }
  });
  it("accepts actual zero prices while preserving unavailable fields as unknown", async () => {
    const [free, unknown] = await listOpenRouterModels("fixture-key", catalog([
      model({ id: "fixture/free:free", pricing: { prompt: "0", completion: 0 } }),
      model({ id: "fixture/unknown", pricing: { prompt: "", completion: "-1" }, context_length: null,
        top_provider: {}, supported_parameters: undefined, architecture: {}, reasoning: {} }),
    ]));
    expect(free).toMatchObject({ inputUsdPerMillion: 0, outputUsdPerMillion: 0, pricingSource: "provider" });
    expect(unknown).toMatchObject({ inputUsdPerMillion: null, outputUsdPerMillion: null, pricingSource: "unknown",
      supportedParameters: null, contextWindow: null, maxOutputTokens: null, reasoning: null, structuredOutput: null,
      inputModalities: [], outputModalities: [], reasoningEfforts: null, reasoningRequired: null });
  });
  it.each([null, undefined, " ", "NaN", "Infinity", "1e999", "-0.1", {}, true])("does not invent a valid price from %s", async (prompt) => {
    const result = await inspectOpenRouterModel("fixture/text-model", "fixture-key", catalog([model({ pricing: { prompt, completion: "0" } })]));
    expect(result.inputUsdPerMillion).toBeNull();
    expect(result.pricingSource).toBe("unknown");
  });
  it("checks a connection without returning key account details or generating tokens", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: { label: "PRIVATE", limit: 7 } }));
    await expect(checkOpenRouterConnection("fixture-key", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", expect.objectContaining({ method: "GET", redirect: "error" }));
  });
  it.each([
    [{ input_cache_write: "0.00000001" }, "additional_charges"],
    [{ input_cache_write_1h: "0.00000001" }, "additional_charges"],
    [{ input_cache_read: "0.0000003" }, "additional_charges"],
    [{ internal_reasoning: "0.0000013" }, "additional_charges"],
    [{ request: "0.001" }, "additional_charges"],
    [{ web_search: "0.01" }, "additional_charges"],
    [{ future_charge: "0.01" }, "additional_charges"],
    [{ future_charge: "invalid" }, "unknown_pricing"],
    [{ internal_reasoning: null }, "unknown_pricing"],
    [{ overrides: [{ min_prompt_tokens: 272000, prompt: "0.0000004" }] }, "tiered_pricing"],
    [{ overrides: {} }, "tiered_pricing"],
  ])("does not certify unbounded billed dimensions: %j", async (extra, issue) => {
    const result = await inspectOpenRouterModel("fixture/text-model", "fixture-key", catalog([
      model({ pricing: { prompt: "0.0000002", completion: "0.0000012", ...extra } }),
    ]));
    expect(result).toMatchObject({ inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2,
      pricingSource: "provider", pricingSupported: false, pricingIssue: issue });
  });
  it("accepts bounded alternate token prices, zeros, and inactive image/audio prices", async () => {
    const result = await inspectOpenRouterModel("fixture/text-model", "fixture-key", catalog([model({ pricing: {
      prompt: "0.0000002", completion: "0.0000012", input_cache_read: "0.0000002", internal_reasoning: "0.0000012",
      input_cache_write: "0", request: "0", future_charge: "0", overrides: [],
      image: "0.01", image_output: "0.5", audio: "0.002", audio_output: "0.04", input_audio_cache: "0.003",
    } })]));
    expect(result).toMatchObject({ pricingSupported: true, pricingIssue: null });
  });
  it.each(["openrouter/auto", "openrouter/auto-beta", "openrouter/fusion", "openrouter/pareto-code", "typesafe/jev-router"])("does not mistake router placeholder prices for free fixed-model inference: %s", async (id) => {
    const result = await inspectOpenRouterModel(id, "fixture-key", catalog([model({ id, pricing: { prompt: "0", completion: "0" } })]));
    expect(result).toMatchObject({ inputUsdPerMillion: 0, outputUsdPerMillion: 0, pricingSupported: false, pricingIssue: "unknown_pricing" });
  });
  it.each([401, 403, 429, 500, 302])("sanitizes HTTP %i and never follows a credential-bearing redirect", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("PRIVATE PROVIDER BODY", { status, headers: { location: "https://attacker.invalid" } }));
    await expect(listOpenRouterModels("fixture-key", fetcher)).rejects.not.toThrow(/PRIVATE|fixture-key|attacker/);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("bounds a stalled fetch even when its implementation ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = expect(listOpenRouterModels("fixture-key", fetcher)).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("bounds a stalled response body", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() {} })));
    const pending = expect(listOpenRouterModels("fixture-key", fetcher)).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;
  });
  it("enforces both declared and streamed response-size limits", async () => {
    for (const response of [new Response("{}", { headers: { "content-length": String(8 * 1024 * 1024 + 1) } }),
      new Response(new Uint8Array(8 * 1024 * 1024 + 1))]) {
      await expect(listOpenRouterModels("fixture-key", async () => response)).rejects.toMatchObject({ code: "invalid_metadata" });
    }
  });
  it("rejects invalid catalog bodies, duplicate exact IDs, and untrusted transport errors", async () => {
    await expect(listOpenRouterModels("fixture-key", async () => Response.json({ data: "wrong" }))).rejects.toMatchObject({ code: "invalid_metadata" });
    await expect(inspectOpenRouterModel("fixture/text-model", "fixture-key", catalog([model(), model()]))).rejects.toMatchObject({ code: "model_not_found" });
    await expect(listOpenRouterModels("fixture-key", async () => { throw new Error("PRIVATE_KEY"); })).rejects.not.toThrow("PRIVATE_KEY");
  });
});

describe("endpoint metadata boundary", () => {
  const endpoint = (overrides: Record<string, unknown> = {}) => ({ model_id: "fixture/text-model", provider_name: "Fixture provider",
    tag: "fixture/fp8", status: 0, context_length: 16_384, max_completion_tokens: 4096, max_prompt_tokens: 12_000,
    supported_parameters: ["max_tokens", "response_format", "structured_outputs"],
    pricing: { prompt: "0.000000021", completion: "0.000000383" }, ...overrides });
  function endpoints(rows: unknown[], zdr: unknown = []) {
    return vi.fn<typeof fetch>(async (url) => {
      if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [model()] });
      if (url === "https://openrouter.ai/api/v1/models/fixture/text-model/endpoints") return Response.json({ data: { id: "fixture/text-model", endpoints: rows } });
      if (url === "https://openrouter.ai/api/v1/endpoints/zdr") return Response.json({ data: zdr });
      throw new Error("Unexpected network destination");
    });
  }
  it("uses endpoint limits, prices and supported parameters rather than the catalog union", async () => {
    const fetcher = endpoints([endpoint()]);
    const result = await inspectOpenRouterEndpoints("fixture/text-model", "standard", "fixture-key", fetcher);
    expect(result.endpoints).toEqual([expect.objectContaining({ inputUsdPerMillion: 0.021, outputUsdPerMillion: 0.383,
      reasoning: false, contextWindow: 16_384, maxOutputTokens: 4096,
      endpoint: { tag: "fixture/fp8", name: "Fixture provider", maxPromptTokens: 12_000 } })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === "error" && init?.cache === "no-store")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-key");
  });
  it.each([
    { tag: "https://attacker.invalid" }, { tag: "../invalid" }, { provider_name: "bad\nname" },
    { model_id: "other/model" }, { status: -1 },
  ])("discards mismatched, unavailable or malformed provider identities: %j", async (change) => {
    expect((await inspectOpenRouterEndpoints("fixture/text-model", "standard", "fixture-key", endpoints([endpoint(change)]))).endpoints).toEqual([]);
  });
  it("discards ambiguous duplicate endpoint tags", async () => {
    expect((await inspectOpenRouterEndpoints("fixture/text-model", "standard", "fixture-key", endpoints([endpoint(), endpoint()]))).endpoints).toEqual([]);
  });
  it("matches zero-retention support by both exact model and endpoint tag", async () => {
    const fetcher = endpoints([endpoint(), endpoint({ tag: "other" })], [
      endpoint(), endpoint({ model_id: "other/model", tag: "other" }),
    ]);
    const result = await inspectOpenRouterEndpoints("fixture/text-model", "zdr", "fixture-key", fetcher);
    expect(result.endpoints.map((item) => item.endpoint?.tag)).toEqual(["fixture/fp8"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const missing = await inspectOpenRouterEndpoints("fixture/text-model", "zdr", "fixture-key", endpoints([endpoint()]));
    expect(missing.endpoints).toEqual([]);
  });
  it("fails closed on invalid endpoint or retention metadata without forwarding response bodies", async () => {
    for (const data of [{ id: "other/model", endpoints: [] }, { id: "fixture/text-model", endpoints: "PRIVATE" }]) {
      const fetcher = endpoints([]);
      const base = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) => String(url).endsWith("/endpoints") ? Promise.resolve(Response.json({ data })) : base(url, init));
      await expect(inspectOpenRouterEndpoints("fixture/text-model", "standard", "fixture-key", fetcher)).rejects.toMatchObject({ code: "invalid_metadata" });
    }
    await expect(inspectOpenRouterEndpoints("fixture/text-model", "zdr", "fixture-key", endpoints([endpoint()], "PRIVATE")))
      .rejects.toMatchObject({ code: "invalid_metadata" });
  });
});
