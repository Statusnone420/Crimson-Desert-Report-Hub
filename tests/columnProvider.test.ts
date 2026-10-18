import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic, countAnthropicTokens } from "@/lib/editorials/anthropic.server";
import { providerKey, resolveCheckerModel, resolveWriterModel, writerEffort } from "@/lib/editorials/config";
import { classifyHttpError, messagesBody, readUsage, type MessagesRequest } from "@/lib/editorials/messages";
import { callOpenRouter, OPENROUTER_MODEL_IDS } from "@/lib/editorials/openrouter.server";
import { meteredCall, settlementFor } from "@/lib/editorials/provider.server";

const request: MessagesRequest = {
  model: "claude-opus-5-5",
  system: [{ text: "STYLE GUIDE", cache: true }, { text: "VOICE", cache: true }, { text: "NOTES AND INSTRUCTION", cache: false }],
  user: "{\"facts\":[]}",
  maxTokens: 8000,
  effort: "high",
  schema: { type: "object" },
  timeoutMs: 5000,
};

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const okBody = {
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"title\":\"x\"}" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0, output_tokens: 900 },
};

describe("the Messages request body", () => {
  it("never sends temperature, top_p or top_k", () => {
    const body = messagesBody(request);
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
  });

  it("caches blocks [A] and [B] only, and asks for adaptive thinking, effort and the JSON schema", () => {
    const body = messagesBody(request) as { system: Record<string, unknown>[]; thinking: unknown; output_config: unknown; max_tokens: number };
    expect(body.system[0]).toEqual({ type: "text", text: "STYLE GUIDE", cache_control: { type: "ephemeral" } });
    expect(body.system[1]).toEqual({ type: "text", text: "VOICE", cache_control: { type: "ephemeral" } });
    expect(body.system[2]).toEqual({ type: "text", text: "NOTES AND INSTRUCTION" });
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema: { type: "object" } } });
    expect(body.max_tokens).toBe(8000);
  });

  it("reads usage only when every count is a whole number", () => {
    expect(readUsage(okBody.usage)).toEqual({ inputTokens: 1200, cacheWriteTokens: 3000, cacheReadTokens: 0, outputTokens: 900 });
    expect(readUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 });
    expect(readUsage({ input_tokens: -1, output_tokens: 5 })).toBeNull();
    expect(readUsage(null)).toBeNull();
  });

  it("sorts provider errors into the column's skip reasons", () => {
    for (const status of [401, 402, 403, 429, 500, 503, 529]) expect(classifyHttpError(status, "")).toBe("provider_unavailable");
    expect(classifyHttpError(400, "Your credit balance is too low to access the Anthropic API.")).toBe("provider_unavailable");
    expect(classifyHttpError(404, "model: claude-x")).toBe("model_not_allowed");
    expect(classifyHttpError(400, "anthropic/claude-x is not a valid model ID")).toBe("model_not_allowed");
    expect(classifyHttpError(400, "messages: roles must alternate")).toBe("invalid_request");
  });
});

describe("the Anthropic client", () => {
  it("posts to the Messages API with the key and version headers and reads the reply", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, okBody));
    const outcome = await callAnthropic(request, "sk-test", fetchImpl);
    expect(outcome).toEqual({ kind: "ok", text: "{\"title\":\"x\"}", stopReason: "end_turn", usage: { inputTokens: 1200, cacheWriteTokens: 3000, cacheReadTokens: 0, outputTokens: 900 }, reportedCostUsd: null });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
  });

  it("retries once on 529 only", async () => {
    const overloaded = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(529, { error: { message: "Overloaded" } })).mockResolvedValueOnce(reply(200, okBody));
    expect((await callAnthropic(request, "sk-test", overloaded)).kind).toBe("ok");
    expect(overloaded).toHaveBeenCalledTimes(2);
    const twice = vi.fn<typeof fetch>().mockImplementation(async () => reply(529, {}));
    expect(await callAnthropic(request, "sk-test", twice)).toEqual({ kind: "rejected", status: 529, reason: "provider_unavailable" });
    expect(twice).toHaveBeenCalledTimes(2);
    const limited = vi.fn<typeof fetch>().mockImplementation(async () => reply(429, {}));
    expect(await callAnthropic(request, "sk-test", limited)).toEqual({ kind: "rejected", status: 429, reason: "provider_unavailable" });
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it("reports a refused key, a low credit balance, a network failure and a timeout without throwing", async () => {
    expect(await callAnthropic(request, "bad", vi.fn<typeof fetch>().mockResolvedValue(reply(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }))))
      .toEqual({ kind: "rejected", status: 401, reason: "provider_unavailable" });
    expect(await callAnthropic(request, "sk", vi.fn<typeof fetch>().mockResolvedValue(reply(400, { error: { message: "Your credit balance is too low" } }))))
      .toEqual({ kind: "rejected", status: 400, reason: "provider_unavailable" });
    expect(await callAnthropic(request, "sk", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")))).toEqual({ kind: "failed", reason: "network" });
    const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    expect(await callAnthropic(request, "sk", vi.fn<typeof fetch>().mockRejectedValue(timeout))).toEqual({ kind: "failed", reason: "timeout" });
  });

  it("counts tokens with the free endpoint and falls back to null", async () => {
    const counter = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { input_tokens: 4321 }));
    expect(await countAnthropicTokens(request, "sk", counter)).toBe(4321);
    expect(counter.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(await countAnthropicTokens(request, "sk", vi.fn<typeof fetch>().mockResolvedValue(reply(401, {})))).toBeNull();
  });
});

describe("the OpenRouter adapter", () => {
  it("sends the same body with OpenRouter's model id, its bearer key and require_parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ...okBody, usage: { ...okBody.usage, cost: 0.0421 } }));
    const outcome = await callOpenRouter(request, "or-column-key", fetchImpl);
    expect(outcome).toMatchObject({ kind: "ok", reportedCostUsd: 0.0421 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/messages");
    expect(init?.headers).toMatchObject({ authorization: "Bearer or-column-key" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "anthropic/claude-opus-5.5", provider: { require_parameters: true }, thinking: { type: "adaptive" } });
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
  });

  it("maps every allowlisted model to OpenRouter's id", () => {
    expect(OPENROUTER_MODEL_IDS).toEqual({
      "claude-opus-5-5": "anthropic/claude-opus-5.5",
      "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
      "claude-fable-5-1": "anthropic/claude-fable-5.1",
      "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
    });
  });
});

describe("column configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("picks the writer by precedence and never falls through past an off-list model", () => {
    expect(resolveWriterModel({ nextEditionModel: "claude-fable-5-1", burstModel: "claude-sonnet-5-5", defaultWriterModel: "claude-opus-5-5", env: env({}) })).toEqual({ ok: true, model: "claude-fable-5-1" });
    expect(resolveWriterModel({ nextEditionModel: null, burstModel: "claude-sonnet-5-5", defaultWriterModel: "claude-opus-5-5", env: env({}) })).toEqual({ ok: true, model: "claude-sonnet-5-5" });
    expect(resolveWriterModel({ nextEditionModel: null, burstModel: null, defaultWriterModel: "claude-sonnet-5-5", env: env({ COLUMN_WRITER_MODEL: "claude-fable-5-1" }) })).toEqual({ ok: true, model: "claude-sonnet-5-5" });
    expect(resolveWriterModel({ nextEditionModel: null, burstModel: null, defaultWriterModel: null, env: env({ COLUMN_WRITER_MODEL: "claude-fable-5-1" }) })).toEqual({ ok: true, model: "claude-fable-5-1" });
    expect(resolveWriterModel({ nextEditionModel: null, burstModel: null, defaultWriterModel: null, env: env({}) })).toEqual({ ok: true, model: "claude-opus-5-5" });
    expect(resolveWriterModel({ nextEditionModel: "gpt-5", burstModel: null, defaultWriterModel: "claude-opus-5-5", env: env({}) })).toEqual({ ok: false, requested: "gpt-5" });
    expect(resolveWriterModel({ nextEditionModel: null, burstModel: null, defaultWriterModel: null, env: env({ COLUMN_WRITER_MODEL: "claude-haiku-5-5" }) })).toEqual({ ok: false, requested: "claude-haiku-5-5" });
  });

  it("allows only Haiku 5.5 as the checker", () => {
    expect(resolveCheckerModel(env({}))).toEqual({ ok: true, model: "claude-haiku-5-5" });
    expect(resolveCheckerModel(env({ COLUMN_CHECKER_MODEL: "claude-opus-5-5" }))).toEqual({ ok: false, requested: "claude-opus-5-5" });
  });

  it("defaults the writer effort to high", () => {
    expect(writerEffort(env({}))).toBe("high");
    expect(writerEffort(env({ COLUMN_WRITER_EFFORT: "medium" }))).toBe("medium");
    expect(writerEffort(env({ COLUMN_WRITER_EFFORT: "max" }))).toBe("high");
  });

  it("reads only the column's own keys, never the scanner's OpenRouter key", () => {
    expect(providerKey("anthropic", env({ ANTHROPIC_API_KEY: "sk-a" }))).toBe("sk-a");
    expect(providerKey("openrouter", env({ OPENROUTER_API_KEY: "scanner-key" }))).toBeNull();
    expect(providerKey("openrouter", env({ OPENROUTER_API_KEY: "scanner-key", COLUMN_OPENROUTER_API_KEY: "column-key" }))).toBe("column-key");
    expect(providerKey("anthropic", env({ ANTHROPIC_API_KEY: "  " }))).toBeNull();
  });
});

describe("the shared ledger", () => {
  const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1000 };

  it("settles a rejected request at $0 and an unreadable one at its reservation", () => {
    expect(settlementFor({ kind: "rejected", status: 401, reason: "provider_unavailable" }, "anthropic", "claude-opus-5-5", 0.3)).toEqual({ state: "settled", usd: 0, usage: null });
    expect(settlementFor({ kind: "failed", reason: "timeout" }, "anthropic", "claude-opus-5-5", 0.3)).toEqual({ state: "estimated", usd: 0.3, usage: null });
    expect(settlementFor({ kind: "ok", text: "{}", stopReason: "end_turn", usage: null, reportedCostUsd: null }, "anthropic", "claude-opus-5-5", 0.3)).toEqual({ state: "estimated", usd: 0.3, usage: null });
  });

  it("settles Anthropic from usage and OpenRouter from its reported cost", () => {
    expect(settlementFor({ kind: "ok", text: "{}", stopReason: "end_turn", usage, reportedCostUsd: null }, "anthropic", "claude-opus-5-5", 0.3)).toEqual({ state: "settled", usd: (1000 * 4 + 1000 * 20) / 1e6, usage });
    expect(settlementFor({ kind: "ok", text: "{}", stopReason: "end_turn", usage, reportedCostUsd: 0.05 }, "openrouter", "claude-opus-5-5", 0.3)).toEqual({ state: "settled", usd: 0.05, usage });
    expect(settlementFor({ kind: "ok", text: "{}", stopReason: "end_turn", usage, reportedCostUsd: null }, "openrouter", "claude-opus-5-5", 0.3)).toEqual({ state: "estimated", usd: (1000 * 4 + 1000 * 20) / 1e6, usage });
  });

  describe("a metered call", () => {
    let rpc: ReturnType<typeof vi.fn>;
    beforeEach(() => { rpc = vi.fn(); });

    it("makes no call when the reservation is blocked", async () => {
      rpc.mockResolvedValue({ data: { status: "blocked", reason: "monthly_cap" }, error: null });
      const fetchImpl = vi.fn<typeof fetch>();
      const result = await meteredCall({ client: { rpc } as unknown as SupabaseClient, operation: "writer", request, promptTokens: 9000, target: { provider: "anthropic", apiKey: "sk", fetchImpl }, monthlyCapSetting: null });
      expect(result).toEqual({ kind: "blocked", reason: "monthly_cap" });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith("editorial_ai_reserve", expect.objectContaining({ p_operation: "writer", p_provider: "anthropic", p_model: "claude-opus-5-5", p_request_cap_usd: 1, p_monthly_cap_usd: 15 }));
    });

    it("reserves, calls and settles a refused key at $0 on the shared ledger", async () => {
      rpc.mockResolvedValueOnce({ data: { status: "reserved" }, error: null }).mockResolvedValueOnce({ data: "settled", error: null });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(401, { error: { message: "invalid key" } }));
      const result = await meteredCall({ client: { rpc } as unknown as SupabaseClient, operation: "checker", request: { ...request, model: "claude-haiku-5-5" }, promptTokens: 9000, target: { provider: "openrouter", apiKey: "or", fetchImpl }, monthlyCapSetting: 20 });
      expect(result).toEqual({ kind: "rejected", reason: "provider_unavailable" });
      expect(rpc).toHaveBeenNthCalledWith(1, "editorial_ai_reserve", expect.objectContaining({ p_provider: "openrouter", p_monthly_cap_usd: 20 }));
      expect(rpc).toHaveBeenNthCalledWith(2, "editorial_ai_settle", expect.objectContaining({ p_state: "settled", p_settled_usd: 0 }));
    });
  });
});
