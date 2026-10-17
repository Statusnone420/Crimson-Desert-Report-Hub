import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { automationModelSettings, maxOpenRouterRequestCostUsd, readOpenRouterUsageCostUsd, isOpenRouterRoutingRefusal, openRouterRequestFitsContext, withOpenRouterRequestTimeout, OpenRouterRequestTimeoutError } from "@/lib/automation/budget";
import { inspectOpenRouterEndpoints } from "./provider.server";
import { profileSchema } from "./validation";
import { aiRpc, readAiConfiguration, readAiConnection, type AiClient } from "./store.server";
import { buildAiTestRequests, evaluateAiTestCase } from "./testSuite";
import type { AiProfile, AiTestCase, AiTestResult } from "./types";
import type { AiTestAttempt } from "./testDiagnostics";
import { beforeAiDeadline, AI_TEST_PREFLIGHT_MS, AI_TEST_VALIDATION_END_MS, AI_TEST_SETTLEMENT_END_MS, AI_TEST_RECEIPT_END_MS } from "./deadline.server";

export const setupInputSchema = z.object({
  modelId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/),
  reasoning: z.enum(["default", "none", "low", "medium", "high"]), retention: z.enum(["standard", "zdr"]),
  maxOutputTokens: z.number().int().min(256).max(8192),
  endpointTag: z.string().max(200).regex(/^(?:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)?$/).optional(),
}).strict();
export type SetupInput = z.infer<typeof setupInputSchema>;

export function profileFingerprint(profile: AiProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

/** Ignore refresh times and parameter ordering, but bind all reviewed settings. */
function quoteFingerprint(profile: AiProfile): string {
  const metadata = profile.metadata;
  return createHash("sha256").update(JSON.stringify({ qualification: "production-cases-v1", ...profile, metadata: { ...metadata, fetchedAt: null,
    supportedParameters: metadata.supportedParameters?.toSorted() ?? null,
    reasoningEfforts: metadata.reasoningEfforts?.toSorted() ?? null,
    inputModalities: metadata.inputModalities.toSorted(), outputModalities: metadata.outputModalities.toSorted(),
  } })).digest("hex");
}

async function selectTestProfile(input: SetupInput, key: string, connectionVersion: number, fetcher: typeof fetch) {
  const { model, endpoints } = await inspectOpenRouterEndpoints(input.modelId, input.retention, key, fetcher);
  const candidates: { profile: AiProfile; testCeilingUsd: number }[] = [];
  const { endpointTag, ...settings } = input;
  for (const metadata of endpoints) {
    try {
      const profile = profileSchema.parse({ ...settings, provider: "openrouter", connectionVersion, metadata });
      automationModelSettings(profile.modelId, undefined, profile);
      const requests = quoteTestRequests(profile);
      const testCeilingUsd = requests.reduce((sum, item) => sum + Math.round(item.reservedUsd * 1e9), 0) / 1e9;
      candidates.push({ profile, testCeilingUsd });
    } catch { /* An incompatible endpoint cannot authorize a paid request. */ }
  }
  return { model, candidates, selected: candidates.find((candidate) => candidate.profile.metadata.endpoint?.tag === endpointTag) ?? null };
}

export async function inspectAiProfile(client: AiClient, rawInput: SetupInput, fetcher: typeof fetch = fetch) {
  const input = setupInputSchema.parse(rawInput);
  const connection = await readAiConnection(client, true);
  if (!connection.key) throw new Error("connection_required");
  const { model, candidates, selected } = await selectTestProfile(input, connection.key, connection.version, fetcher);
  return { metadata: selected?.profile.metadata ?? model, connectionVersion: connection.version, compatible: selected !== null,
    endpoints: candidates.map(({ profile }) => ({ tag: profile.metadata.endpoint!.tag, name: profile.metadata.endpoint!.name })),
    testCeilingUsd: selected?.testCeilingUsd ?? null, quote: selected ? quoteFingerprint(selected.profile) : null };
}

function quoteTestRequests(profile: AiProfile) {
  const settings = automationModelSettings(profile.modelId, undefined, profile);
  return buildAiTestRequests(profile).map(({ id, request }) => {
    const body = JSON.stringify(request);
    const outputTokens = Number((request as Record<string, unknown>)[settings.outputTokenParameter]);
    if (!openRouterRequestFitsContext(body, outputTokens, profile)) throw new Error("context_too_small");
    const reservedUsd = Math.ceil(maxOpenRouterRequestCostUsd(body, outputTokens, profile.modelId, undefined, profile) * 1e9) / 1e9;
    return { id, body, reservedUsd };
  });
}

/** One six-request batch per id; reserve its aggregate maximum before any dispatch. */
export async function runAiTest(client: AiClient, id: string, rawInput: SetupInput, quote: string, fetcher: typeof fetch = fetch,
  execution: { startedAtMs: number; signal?: AbortSignal } = { startedAtMs: Date.now() }): Promise<AiTestResult> {
  const startedAt = execution.startedAtMs;
  let metadataMs = 0; let reservationMs = 0;
  let preflightStage = "configuration"; let stageStarted = Date.now();
  const { profile, reservedUsd, key, requests } = await beforeAiDeadline(startedAt + AI_TEST_PREFLIGHT_MS, async (signal) => {
    const input = setupInputSchema.parse(rawInput);
    const configuration = await readAiConfiguration(client, signal);
    signal.throwIfAborted();
    if (!configuration) throw new Error("ai_settings_unavailable");
    preflightStage = "connection"; stageStarted = Date.now();
    const connection = await readAiConnection(client, true, signal);
    signal.throwIfAborted();
    if (!connection.key) throw new Error("connection_required");
    const metadataStarted = Date.now();
    preflightStage = "metadata"; stageStarted = metadataStarted;
    const boundedFetch: typeof fetch = (url, init) => fetcher(url, { ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    const { selected } = await selectTestProfile(input, connection.key, connection.version, boundedFetch);
    signal.throwIfAborted();
    metadataMs = Date.now() - metadataStarted;
    if (!selected) throw new Error("no_compatible_endpoint");
    const { profile, testCeilingUsd: reservedUsd } = selected;
    if (quote !== quoteFingerprint(profile)) throw new Error("ai_quote_changed");
    const requests = quoteTestRequests(profile);
    if (reservedUsd > Math.min(0.01, configuration.policy.requestUsd)) throw new Error("test_exceeds_limit");
    const reservationStarted = Date.now();
    preflightStage = "reservation"; stageStarted = reservationStarted;
    const reserved = await aiRpc(client, "ai_test_reserve", { p_id: id, p_usd: reservedUsd }, signal);
    signal.throwIfAborted();
    reservationMs = Date.now() - reservationStarted;
    if (reserved.firstAcknowledgement !== true || reserved.state !== "reserved") throw new Error("test_already_started");
    return { profile, reservedUsd, key: connection.key, requests };
  }, execution.signal).catch((error) => {
    console.info("ai_qualification_preflight", { id, stage: preflightStage, stageMs: Date.now() - stageStarted, totalMs: Date.now() - startedAt });
    throw error;
  });
  const preflightMs = Date.now() - startedAt;
  const receipt: AiTestResult = { id, profile, passed: false, cases: [], outcome: "provider_failure", costUsd: null, reservedUsd,
    costState: "unknown", latencyMs: 0, createdAt: new Date().toISOString() };
  const requestsStarted = Date.now();
  receipt.cases = await Promise.all(requests.map((item) => runTestCase(item, key, fetcher, execution)));
  const requestsMs = Date.now() - requestsStarted;
  if (receipt.cases.every((item) => item.attempt!.costState !== "unknown")) {
    receipt.costUsd = Number(receipt.cases.reduce((sum, item) => sum + item.attempt!.costUsd!, 0).toFixed(12));
    receipt.costState = receipt.cases.every((item) => item.attempt!.costState === "not_sent") ? "not_sent" : "verified";
  }
  receipt.passed = receipt.costState === "verified" && receipt.cases.length === 6 && receipt.cases.every((item) => item.passed);
  receipt.outcome = receipt.passed ? "passed" : receipt.cases.find((item) => !item.passed)?.attempt?.outcome ?? "provider_failure";
  const settlementStarted = Date.now();
  let settlement: "acknowledged" | "unconfirmed" = "acknowledged";
  try {
    await beforeAiDeadline(startedAt + AI_TEST_SETTLEMENT_END_MS, (signal) => aiRpc(client, "ai_test_settle",
      { p_id: id, p_state: receipt.costState, p_usd: receipt.costUsd }, signal));
  } catch {
    // Preserve each case's evidence even if the ledger acknowledgement is lost.
    settlement = "unconfirmed";
    receipt.passed = false; receipt.outcome = "accounting_unconfirmed";
    receipt.costState = "unknown"; receipt.costUsd = null;
  }
  receipt.latencyMs = Date.now() - startedAt;
  receipt.timings = { preflightMs, metadataMs, reservationMs, requestsMs, settlementMs: Date.now() - settlementStarted,
    receiptStartedAfterMs: receipt.latencyMs, settlement };
  const receiptStarted = Date.now();
  let saved = false;
  try {
    const { error } = await beforeAiDeadline(startedAt + AI_TEST_RECEIPT_END_MS, (signal) =>
      client.from("ai_model_tests").insert({ id, profile, fingerprint: profileFingerprint(profile), result: receipt }).abortSignal(signal));
    if (error) throw new Error("test_receipt_unavailable");
    saved = true;
    return receipt;
  } catch { throw new Error("test_receipt_unavailable"); }
  finally {
    // An append-only receipt cannot contain its own completed write duration.
    console.info("ai_qualification_receipt", { id, saved, receiptMs: Date.now() - receiptStarted, totalMs: Date.now() - startedAt });
  }
}

async function runTestCase(item: ReturnType<typeof quoteTestRequests>[number], key: string, fetcher: typeof fetch,
  execution: { startedAtMs: number; signal?: AbortSignal }): Promise<AiTestCase> {
  const startedAt = Date.now();
  let result = evaluateAiTestCase(item.id, "{}");
  const attempt: AiTestAttempt = { outcome: "not_sent", costState: "not_sent", costUsd: 0, reservedUsd: item.reservedUsd,
    timings: { headersAfterMs: null, bodyAfterMs: null, validationMs: null, totalMs: 0, httpStatus: null } };
  try {
    if (execution.signal?.aborted || startedAt > execution.startedAtMs + AI_TEST_PREFLIGHT_MS) return { ...result, detail: "This request was not sent.", attempt };
    attempt.costState = "unknown"; attempt.costUsd = null;
    const { response, payload } = await withOpenRouterRequestTimeout(async (deadlineSignal) => {
      const signal = execution.signal ? AbortSignal.any([deadlineSignal, execution.signal]) : deadlineSignal;
      signal.throwIfAborted();
      const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", { method: "POST", redirect: "error", cache: "no-store",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: item.body, signal });
      signal.throwIfAborted();
      attempt.timings.headersAfterMs = Date.now() - startedAt;
      attempt.timings.httpStatus = response.status;
      const payload = await boundedTestResponse(response, signal, () => { attempt.timings.bodyAfterMs = Date.now() - startedAt; });
      signal.throwIfAborted();
      return { response, payload };
    }, execution.startedAtMs + AI_TEST_VALIDATION_END_MS - 1000);
    const cost = readOpenRouterUsageCostUsd(payload);
    if (cost !== null) { attempt.costUsd = cost; attempt.costState = "verified"; }
    if (!response.ok) {
      attempt.outcome = response.status === 401 || response.status === 403 ? "authentication" : response.status === 429 ? "rate_limit" : "provider_failure";
      if (isOpenRouterRoutingRefusal(response.status, payload)) { attempt.outcome = "no_matching_endpoint"; attempt.costUsd = 0; attempt.costState = "verified"; }
    } else if (cost === null) attempt.outcome = "cost_unverified";
    else if (cost > item.reservedUsd) attempt.outcome = "cost_exceeded";
    else {
      const validationStarted = Date.now();
      result = evaluateAiTestCase(item.id, readContent(payload));
      attempt.timings.validationMs = Date.now() - validationStarted;
      attempt.outcome = result.passed ? "passed" : "task_checks_failed";
      if (attempt.timings.validationMs > 1000 || Date.now() > execution.startedAtMs + AI_TEST_VALIDATION_END_MS) {
        result.passed = false; attempt.outcome = "validation_timeout";
      }
    }
  } catch (error) {
    attempt.outcome = error instanceof OpenRouterRequestTimeoutError || execution.signal?.aborted ? "timeout" :
      attempt.costState === "verified" || attempt.timings.bodyAfterMs !== null ? "invalid_response" : "provider_failure";
  } finally { attempt.timings.totalMs = Date.now() - startedAt; }
  if (!result.passed && attempt.outcome !== "task_checks_failed") result.detail = "This request did not produce a validated, cost-verified result.";
  return { ...result, attempt: { ...attempt, timings: { ...attempt.timings } } };
}

async function boundedTestResponse(response: Response, signal: AbortSignal, bodyReceived: () => void): Promise<unknown> {
  if (!response.body) throw new Error("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0; let text = "";
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128_000) { cancel(); throw new Error("invalid_response"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    bodyReceived();
    return JSON.parse(text + decoder.decode());
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

function readContent(value: unknown): string {
  const parsed = value as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("invalid_response");
  return content;
}
