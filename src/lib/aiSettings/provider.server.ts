import "server-only";
import type { AiMetadata, AiRetention } from "./types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_ZDR_URL = "https://openrouter.ai/api/v1/endpoints/zdr";
const METADATA_TIMEOUT_MS = 8_000;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

/** Errors contain fixed application text, never provider bodies or credentials. */
export class AiProviderError extends Error {
  constructor(public readonly code: "authentication" | "rate_limit" | "provider" | "timeout" | "invalid_metadata" | "model_not_found") {
    super({ authentication: "OpenRouter did not accept this connection.", rate_limit: "OpenRouter temporarily limited this request.",
      provider: "OpenRouter could not complete this request.", timeout: "OpenRouter metadata request timed out.",
      invalid_metadata: "OpenRouter returned invalid or oversized model information.", model_not_found: "This exact model ID is not in the OpenRouter catalog." }[code]);
    this.name = "AiProviderError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] | null {
  return Array.isArray(value) && value.length <= maxItems && value.every((entry) => typeof entry === "string" && entry.length <= maxLength)
    ? [...new Set(value as string[])] : null;
}

/** Catalog prices are USD per token. Missing and malformed prices are unknown. */
function pricePerMillion(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  // Shift the decimal exponent before converting to binary floating point. A
  // multiplication can round 0.20 down and incorrectly exclude its own route.
  const [mantissa, exponent = "0"] = String(value).split(/e/i);
  const price = Number(`${mantissa}e${Number(exponent) + 6}`);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

/** Only certify prices covered by the text-only request's token reservation. */
function pricingIssue(pricing: Record<string, unknown>, prompt: number | null, completion: number | null): AiMetadata["pricingIssue"] {
  if (prompt === null || completion === null) return "unknown_pricing";
  if ("overrides" in pricing && (!Array.isArray(pricing.overrides) || pricing.overrides.length > 0)) return "tiered_pricing";
  for (const [dimension, value] of Object.entries(pricing)) {
    if (["prompt", "completion", "overrides"].includes(dimension)) continue;
    // No input attachments are sent and output modalities are explicitly text.
    if (["image", "image_output", "audio", "audio_output", "input_audio_cache"].includes(dimension)) continue;
    const price = pricePerMillion(value);
    if (price === null) return "unknown_pricing";
    if (dimension === "input_cache_read" && price <= prompt) continue;
    // Reasoning consumes the same capped completion budget as visible output.
    if (dimension === "internal_reasoning" && price <= completion) continue;
    // Cache writes can be automatic or include storage charges. Search can be
    // built into a model. Neither is bounded by provider.max_price token caps.
    if (price > 0) return "additional_charges";
  }
  return null;
}

function metadata(value: unknown, fetchedAt: string): AiMetadata | null {
  const row = record(value);
  if (typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,199}$/.test(row.id)) return null;
  const architecture = record(row.architecture);
  const topProvider = record(row.top_provider);
  const pricing = record(row.pricing);
  const reasoning = record(row.reasoning);
  const supportedParameters = strings(row.supported_parameters, 100, 80);
  const name = typeof row.name === "string" ? row.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) : "";
  const inputUsdPerMillion = pricePerMillion(pricing.prompt);
  const outputUsdPerMillion = pricePerMillion(pricing.completion);
  // Router products do not describe one fixed model's billable work, even when
  // the public catalog displays zero prices. They need a separate integration.
  const routedModel = ["openrouter/auto", "openrouter/auto-beta", "openrouter/fusion", "openrouter/pareto-code", "typesafe/jev-router"].includes(row.id);
  const issue = routedModel ? "unknown_pricing" : pricingIssue(pricing, inputUsdPerMillion, outputUsdPerMillion);
  return {
    provider: "openrouter", id: row.id,
    name: name || row.id,
    contextWindow: positiveInteger(row.context_length) ?? positiveInteger(topProvider.context_length),
    maxOutputTokens: positiveInteger(topProvider.max_completion_tokens),
    inputModalities: strings(architecture.input_modalities, 12, 40) ?? [],
    outputModalities: strings(architecture.output_modalities, 12, 40) ?? [],
    supportedParameters,
    reasoning: supportedParameters === null ? null : supportedParameters.includes("reasoning"),
    reasoningEfforts: strings(reasoning.supported_efforts, 12, 30),
    reasoningRequired: typeof reasoning.mandatory === "boolean" ? reasoning.mandatory : null,
    structuredOutput: supportedParameters === null ? null : supportedParameters.includes("structured_outputs"),
    inputUsdPerMillion, outputUsdPerMillion,
    pricingSource: inputUsdPerMillion !== null && outputUsdPerMillion !== null ? "provider" : "unknown",
    pricingSupported: issue === null, pricingIssue: issue,
    fetchedAt,
  };
}

async function readBoundedJson(response: Response, controller: AbortController): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_METADATA_BYTES) {
    controller.abort();
    throw new AiProviderError("invalid_metadata");
  }
  if (!response.body) throw new AiProviderError("invalid_metadata");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_METADATA_BYTES) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new AiProviderError("invalid_metadata");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("invalid_metadata");
  } finally {
    reader.releaseLock();
  }
}

async function readProvider(url: typeof OPENROUTER_MODELS_URL | typeof OPENROUTER_KEY_URL | typeof OPENROUTER_ZDR_URL | `${typeof OPENROUTER_MODELS_URL}/${string}/endpoints`, apiKey: string, fetcher: typeof fetch): Promise<unknown> {
  const key = apiKey.trim();
  if (!key || /[\r\n]/.test(key)) throw new AiProviderError("authentication");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { reject(new AiProviderError("timeout")); controller.abort(); }, METADATA_TIMEOUT_MS);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher(url, { method: "GET", headers: { authorization: `Bearer ${key}` },
        redirect: "error", cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        controller.abort();
        throw new AiProviderError(response.status === 401 || response.status === 403 ? "authentication" :
          response.status === 429 ? "rate_limit" : "provider");
      }
      return readBoundedJson(response, controller);
    })(), timedOut]);
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("provider");
  } finally {
    clearTimeout(timeout);
  }
}

/** A read-only connection check; it does not generate tokens or expose key data. */
export async function checkOpenRouterConnection(apiKey: string, fetcher: typeof fetch = fetch): Promise<void> {
  const body = record(await readProvider(OPENROUTER_KEY_URL, apiKey, fetcher));
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new AiProviderError("invalid_metadata");
}

export async function listOpenRouterModels(apiKey: string, fetcher: typeof fetch = fetch): Promise<AiMetadata[]> {
  const body = record(await readProvider(OPENROUTER_MODELS_URL, apiKey, fetcher));
  if (!Array.isArray(body.data) || body.data.length > 5_000) throw new AiProviderError("invalid_metadata");
  const fetchedAt = new Date().toISOString();
  return body.data.map((value) => metadata(value, fetchedAt)).filter((value): value is AiMetadata => value !== null);
}

/** Exact IDs only: aliases, names, and provider-supplied URLs never select a route. */
export async function inspectOpenRouterModel(modelId: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<AiMetadata> {
  const id = modelId.trim();
  if (!id || id.length > 200) throw new AiProviderError("model_not_found");
  const matches = (await listOpenRouterModels(apiKey, fetcher)).filter((model) => model.id === id);
  if (matches.length !== 1) throw new AiProviderError("model_not_found");
  return matches[0];
}

/** Prices and required parameters must describe the same provider endpoint. */
export async function inspectOpenRouterEndpoints(modelId: string, retention: AiRetention, apiKey: string, fetcher: typeof fetch = fetch) {
  const model = await inspectOpenRouterModel(modelId, apiKey, fetcher);
  // Router products are not fixed-model quotes. Never turn their zero catalog
  // prices into a free request, or use provider-supplied URLs with our key.
  if (["openrouter/auto", "openrouter/auto-beta", "openrouter/fusion", "openrouter/pareto-code", "typesafe/jev-router"].includes(model.id)) {
    return { model, endpoints: [] as AiMetadata[] };
  }
  const parts = model.id.split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === "..")) throw new AiProviderError("invalid_metadata");
  const body = record(await readProvider(`${OPENROUTER_MODELS_URL}/${parts.map(encodeURIComponent).join("/")}/endpoints`, apiKey, fetcher));
  const data = record(body.data);
  if (data.id !== model.id || !Array.isArray(data.endpoints) || data.endpoints.length > 500) throw new AiProviderError("invalid_metadata");
  let zdrTags: Set<string> | null = null;
  if (retention === "zdr") {
    const zdr = record(await readProvider(OPENROUTER_ZDR_URL, apiKey, fetcher));
    if (!Array.isArray(zdr.data) || zdr.data.length > 20_000) throw new AiProviderError("invalid_metadata");
    zdrTags = new Set(zdr.data.flatMap((value) => {
      const endpoint = record(value);
      return endpoint.model_id === model.id && endpoint.status === 0 && typeof endpoint.tag === "string" ? [endpoint.tag] : [];
    }));
  }
  const endpoints = data.endpoints.flatMap((value): AiMetadata[] => {
    const row = record(value);
    if (row.model_id !== model.id || row.status !== 0 || typeof row.tag !== "string" || row.tag.length > 200 ||
      !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(row.tag) ||
      typeof row.provider_name !== "string" || !row.provider_name.trim() || row.provider_name.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(row.provider_name) || (zdrTags && !zdrTags.has(row.tag))) return [];
    const pricing = record(row.pricing);
    const inputUsdPerMillion = pricePerMillion(pricing.prompt);
    const outputUsdPerMillion = pricePerMillion(pricing.completion);
    const issue = pricingIssue(pricing, inputUsdPerMillion, outputUsdPerMillion);
    const supportedParameters = strings(row.supported_parameters, 100, 80);
    const reasoning = record(row.reasoning);
    return [{ ...model,
      contextWindow: positiveInteger(row.context_length), maxOutputTokens: positiveInteger(row.max_completion_tokens),
      supportedParameters, reasoning: supportedParameters === null ? null : supportedParameters.includes("reasoning"),
      reasoningEfforts: strings(reasoning.supported_efforts, 12, 30) ?? model.reasoningEfforts,
      reasoningRequired: typeof reasoning.mandatory === "boolean" ? reasoning.mandatory : model.reasoningRequired,
      structuredOutput: supportedParameters === null ? null : supportedParameters.includes("structured_outputs"),
      inputUsdPerMillion, outputUsdPerMillion, pricingSource: inputUsdPerMillion !== null && outputUsdPerMillion !== null ? "provider" : "unknown",
      pricingSupported: issue === null, pricingIssue: issue,
      endpoint: { tag: row.tag, name: row.provider_name.trim(), maxPromptTokens: positiveInteger(row.max_prompt_tokens) },
      fetchedAt: new Date().toISOString(),
    }];
  });
  // Ambiguous duplicate tags cannot identify one reviewed route and price.
  return { model, endpoints: endpoints.filter((candidate) => endpoints.filter((other) => other.endpoint!.tag === candidate.endpoint!.tag).length === 1) };
}
