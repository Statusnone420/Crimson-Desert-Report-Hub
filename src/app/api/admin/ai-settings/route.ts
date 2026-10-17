import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/adminGuard";
import { isAiSettingsLiveAllowed } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";
import { sealAiKey } from "@/lib/aiSettings/credentials.server";
import { AiProviderError, checkOpenRouterConnection, listOpenRouterModels } from "@/lib/aiSettings/provider.server";
import { aiRpc, readAiConnection, readAiDashboard } from "@/lib/aiSettings/store.server";
import { inspectAiProfile, runAiTest, setupInputSchema } from "@/lib/aiSettings/service.server";
import { policySchema } from "@/lib/aiSettings/validation";
import { beforeAiDeadline, AI_TEST_PREFLIGHT_MS } from "@/lib/aiSettings/deadline.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const revision = z.number().int().nonnegative();
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connection"), key: z.string().min(20).max(1024).regex(/^[\x21-\x7e]+$/), version: revision }).strict(),
  z.object({ action: z.literal("catalog") }).strict(),
  z.object({ action: z.literal("inspect"), input: setupInputSchema }).strict(),
  z.object({ action: z.literal("test"), id: z.uuid(), input: setupInputSchema, quote: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("activate"), revision, testId: z.uuid(), role: z.enum(["primary", "backup"]) }).strict(),
  z.object({ action: z.literal("rollback"), revision }).strict(),
  z.object({ action: z.literal("policy"), revision, policy: policySchema }).strict(),
]);
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET() {
  if (!await isAdmin()) return response({ error: "unauthorized" }, 401);
  if (!isAiSettingsLiveAllowed()) return response({ error: "preview_writes_disabled" }, 403);
  try { return response(await readAiDashboard()); } catch { return response({ error: "ai_settings_unavailable" }, 503); }
}

export async function POST(request: Request) {
  const startedAtMs = Date.now();
  try {
    if (!await beforeAiDeadline(startedAtMs + AI_TEST_PREFLIGHT_MS, () => isAdmin(), request.signal)) return response({ error: "unauthorized" }, 401);
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "qualification_deadline";
    return response({ error: timedOut ? "qualification_deadline" : "ai_settings_unavailable" }, timedOut ? 422 : 503);
  }
  if (!isAiSettingsLiveAllowed()) return response({ error: "preview_writes_disabled" }, 403);
  const origins = new Set([SITE_URL]);
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost && /^[a-zA-Z0-9.-]+$/.test(productionHost)) origins.add(`https://${productionHost}`);
  if (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "invalid_origin" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ error: "invalid_request" }, 415);
  try {
    const command = commandSchema.parse(await beforeAiDeadline(startedAtMs + AI_TEST_PREFLIGHT_MS, (signal) => readCommand(request, signal), request.signal));
    const client = createServiceClient();
    if (command.action === "connection") {
      // Ensure encryption is configured before contacting the provider.
      const ciphertext = sealAiKey(command.key);
      await checkOpenRouterConnection(command.key);
      await aiRpc(client, "ai_connection_save", { p_ciphertext: ciphertext, p_expected_version: command.version });
    } else if (command.action === "catalog") {
      const connection = await readAiConnection(client, true);
      if (!connection.key) throw new Error("connection_required");
      return response({ models: await listOpenRouterModels(connection.key) });
    } else if (command.action === "inspect") return response(await inspectAiProfile(client, command.input));
    else if (command.action === "test") return response({ test: await runAiTest(client, command.id, command.input, command.quote, undefined, { startedAtMs, signal: request.signal }) });
    else if (command.action === "policy") await aiRpc(client, "ai_settings_save", { p_revision: command.revision, p_policy: command.policy });
    else await aiRpc(client, "ai_settings_activate", { p_revision: command.revision,
      p_test_id: command.action === "activate" ? command.testId : null, p_role: command.action === "activate" ? command.role : "rollback" });
    return response(await readAiDashboard(client));
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "invalid_request" }, 400);
    if (error instanceof AiProviderError) return response({ error: `provider_${error.code}` }, 422);
    const safeErrors = ["encryption_not_configured", "credential_unavailable", "connection_required", "test_exceeds_limit", "context_too_small", "pricing_unsupported", "model_incompatible",
      "no_compatible_endpoint", "ai_quote_changed", "test_already_started", "test_receipt_unavailable", "qualification_deadline", "ai_revision_conflict", "ai_connection_conflict", "ai_spending_blocked", "ai_test_not_valid", "ai_connection_changed", "ai_no_previous_model", "invalid_request"];
    const message = error instanceof Error && safeErrors.includes(error.message) ? error.message : "ai_settings_unavailable";
    return response({ error: message }, message.endsWith("conflict") ? 409 : message === "ai_settings_unavailable" ? 503 : 422);
  }
}

async function readCommand(request: Request, signal: AbortSignal): Promise<unknown> {
  if (!request.body || Number(request.headers.get("content-length")) > 8192) throw new Error("invalid_request");
  const reader = request.body.getReader(); const decoder = new TextDecoder();
  let bytes = 0; let body = "";
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read(); signal.throwIfAborted(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new Error("invalid_request"); }
      body += decoder.decode(part.value, { stream: true });
    }
    try { return JSON.parse(body + decoder.decode()); } catch { throw new Error("invalid_request"); }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
