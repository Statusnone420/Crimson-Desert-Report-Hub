import "server-only";
import { createServiceClient } from "@/lib/supabase";
import { aiEncryptionReady, openAiKey } from "./credentials.server";
import { configurationSchema, profileSchema } from "./validation";
import { DEFAULT_AI_POLICY, type AiConfiguration, type AiDashboard, type AiTestResult } from "./types";
import { sanitizedTestDiagnostics, sanitizedTestTimings } from "./testDiagnostics";

export type AiClient = ReturnType<typeof createServiceClient>;
export const emptyConfiguration = (): AiConfiguration => ({ revision: 0, active: null, previous: null, backup: null, policy: { ...DEFAULT_AI_POLICY } });

export async function readAiConfiguration(client: AiClient, signal?: AbortSignal): Promise<AiConfiguration | null> {
  const query = client.from("ai_settings_state").select("revision,configuration").eq("id", true);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).limit(1);
  if (error) {
    // Only the absent new relation permits the existing scanner to continue.
    const absentRelation = error.code === "42P01" && /^relation "(?:public\.)?ai_settings_state" does not exist$/.test(error.message);
    const absentCacheEntry = error.code === "PGRST205" && error.message === "Could not find the table 'public.ai_settings_state' in the schema cache";
    if (absentRelation || absentCacheEntry) return null;
    throw new Error("ai_settings_unavailable");
  }
  const row = data?.[0];
  if (!row) throw new Error("ai_settings_unavailable");
  return configurationSchema.parse({ ...row.configuration, revision: row.revision });
}

export async function readAiConnection(client: AiClient, includeKey = false, signal?: AbortSignal) {
  const query = client.from("ai_connections")
    .select(includeKey ? "version,ciphertext" : "version").eq("provider", "openrouter");
  const { data, error } = await (signal ? query.abortSignal(signal) : query).limit(1);
  if (error) throw new Error("ai_settings_unavailable");
  const row = data?.[0] as unknown as { version: number; ciphertext?: string } | undefined;
  const envKey = process.env.OPENROUTER_API_KEY?.trim();
  if (row) return { provider: "openrouter" as const, configured: true, source: "saved" as const, version: row.version,
    ...(includeKey ? { key: openAiKey(row.ciphertext ?? "") } : {}) };
  return { provider: "openrouter" as const, configured: Boolean(envKey), source: envKey ? "environment" as const : "none" as const, version: 0,
    ...(includeKey ? { key: envKey } : {}) };
}

export async function aiRpc(client: AiClient, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const query = client.rpc(name, args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error || !data || typeof data !== "object") {
    const known: Record<string, string> = { ai_settings_revision_conflict: "ai_revision_conflict", ai_connection_version_conflict: "ai_connection_conflict",
      ai_spending_blocked: "ai_spending_blocked", ai_test_required: "ai_test_not_valid", ai_connection_changed: "ai_connection_changed" };
    throw new Error(known[error?.message ?? ""] ?? "ai_settings_unavailable");
  }
  return data as Record<string, unknown>;
}

export async function readAiDashboard(client: AiClient = createServiceClient()): Promise<AiDashboard> {
  const configuration = await readAiConfiguration(client);
  if (!configuration) return { available: false, encryptionReady: aiEncryptionReady(), configuration: emptyConfiguration(), connections: [],
    spend: { committedUsd: 0, uncertainUsd: 0, estimatedUsd: 0, blocked: true }, tests: [], activity: [] };
  const [connection, summary, tests, events] = await Promise.all([
    readAiConnection(client), client.rpc("scanner_budget_summary"),
    client.from("ai_model_tests").select("result").order("created_at", { ascending: false }).limit(20),
    client.from("ai_settings_events").select("id,action,detail,created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  if (summary.error || tests.error || events.error) throw new Error("ai_settings_unavailable");
  const spend = summary.data as Record<string, unknown>;
  const amount = (key: string) => {
    const value = spend?.[key];
    if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error("ai_settings_unavailable");
    return Number(value);
  };
  return { available: true, encryptionReady: aiEncryptionReady(), configuration, connections: [connection],
    spend: { committedUsd: amount("llmCostUsd"), uncertainUsd: amount("uncertainUsd"), estimatedUsd: amount("estimatedUsd"), blocked: spend.openRouterCircuitOpen === true },
    tests: (tests.data ?? []).map((row) => sanitizeTestResult(row.result)),
    activity: (events.data ?? []).map((row) => ({ id: String(row.id), createdAt: String(row.created_at), action: String(row.action), detail: String(row.detail) })) };
}

function sanitizeTestResult(value: unknown): AiTestResult {
  if (!value || typeof value !== "object") throw new Error("ai_settings_unavailable");
  const row = value as AiTestResult;
  // Never serialize a storage row wholesale. Receipts contain only known shapes.
  return { id: row.id, profile: profileSchema.parse(row.profile), passed: row.passed === true, outcome: row.outcome,
    costUsd: row.costUsd, reservedUsd: row.reservedUsd, costState: row.costState, latencyMs: row.latencyMs, createdAt: row.createdAt,
    ...(sanitizedTestTimings(row.timings) ? { timings: sanitizedTestTimings(row.timings) } : {}),
    cases: row.cases.map(({ name, passed, expected, detail, attempt }) => ({ name, passed, expected, detail,
      ...(sanitizedTestDiagnostics(attempt) ? { attempt: sanitizedTestDiagnostics(attempt) } : {}) })) };
}

export async function recordAiEvent(client: AiClient, action: string, detail: string): Promise<void> {
  const { error } = await client.from("ai_settings_events").insert({ action: action.slice(0,80), detail: detail.slice(0,500) });
  if (error) throw new Error("ai_settings_unavailable");
}
