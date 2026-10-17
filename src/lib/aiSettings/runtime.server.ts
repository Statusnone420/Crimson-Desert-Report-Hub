import "server-only";
import { createHash } from "node:crypto";
import { automationModelSettings, type AutomationBudget } from "@/lib/automation/budget";
import type { OpenRouterAttemptReporter } from "@/lib/automation/openRouterTrace";
import type { ScannerPolicy } from "@/lib/automation/settings";
import { readAiConfiguration, readAiConnection, recordAiEvent, type AiClient } from "./store.server";
import { profileSchema } from "./validation";
import type { AiPolicy, AiProfile } from "./types";

type RequestOptions = { llmCallsRemaining: number; llmBudgetRemainingUsd?: number; onAttempt?: OpenRouterAttemptReporter };
type HealthResult = { llmCallsUsed: number; llmSucceeded?: number; skips: string[] };
const FAILURES = ["timeout", "transport_failure", "http_failure", "decode_failure", "validation_failure", "cost_unverified", "budget_exceeded",
  "openrouter_provider_failure", "openrouter_invalid_json", "openrouter_cost_unverified", "openrouter_budget_exceeded", "openrouter_no_route"] as const;
const ACCOUNTING_FAILURES = ["accounting_unavailable", "settlement_unacknowledged", "reservation_unacknowledged", "spending_blocked"];
const DAY_MS = 24 * 60 * 60_000;
const PRIMARY_COOLDOWN_MS = 4 * 60 * 60_000;

export type AiRuntime = {
  readonly profile: AiProfile | null;
  readonly policy: AiPolicy | null;
  readonly blockedReason: string | null;
  readonly failed: boolean;
  apply<T extends RequestOptions>(options: T): T & { configuredModel?: AiProfile; apiKey: string };
  record(result: HealthResult): Promise<void>;
};

// Credentials are captured by apply(), never stored in a budget or serialized.
const runtimes = new WeakMap<AutomationBudget, AiRuntime>();
export function attachAiRuntime(budget: AutomationBudget, runtime: AiRuntime | null): void {
  if (runtime) runtimes.set(budget, runtime);
}
export function aiRuntimeForBudget(budget: AutomationBudget): AiRuntime | undefined { return runtimes.get(budget); }
export function applyAiRuntimeOptions<T extends RequestOptions>(budget: AutomationBudget, options: T): T {
  return runtimes.get(budget)?.apply(options) ?? options;
}
export function managedScannerPolicy(policy: ScannerPolicy, runtime: AiRuntime | null): ScannerPolicy {
  return runtime?.policy ? { ...policy, monthlyLlmUsdCap: runtime.policy.monthlyUsd, aiManaged: true } : policy;
}

export function aiRuntimeFingerprint(profile: AiProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function blockedRuntime(reason: string, policy: AiPolicy | null): AiRuntime {
  return { profile: null, policy, blockedReason: reason, failed: true,
    apply: (options) => ({ ...options, apiKey: "", llmCallsRemaining: 0 }), record: async () => {} };
}

async function selectProfile(client: AiClient, active: AiProfile, backup: AiProfile | null, now: Date): Promise<AiProfile> {
  if (!backup) return active;
  const { data, error } = await client.from("ai_settings_events").select("action,detail,created_at")
    .in("action", ["ai_request_success", "ai_request_failure"])
    .gte("created_at", new Date(now.getTime() - DAY_MS).toISOString()).order("created_at", { ascending: false }).limit(30);
  if (error || !Array.isArray(data)) throw new Error("ai_health_unavailable");
  const fingerprint = aiRuntimeFingerprint(active);
  const history = data.flatMap((row) => {
    if (row.action !== "ai_request_success" && row.action !== "ai_request_failure") return [];
    const time = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
    if (!Number.isFinite(time) || time > now.getTime() || time < now.getTime() - DAY_MS || typeof row.detail !== "string" || row.detail.length > 500) return [];
    try {
      const detail = JSON.parse(row.detail) as { fingerprint?: unknown; code?: unknown };
      if (detail.fingerprint !== fingerprint || (detail.code !== "success" && !FAILURES.some((code) => code === detail.code))) return [];
      if ((row.action === "ai_request_success") !== (detail.code === "success")) return [];
      return [{ action: row.action, time }];
    } catch { return []; }
  }).sort((a, b) => b.time - a.time);
  if (history.length < 2 || history[0].action !== "ai_request_failure" || history[1].action !== "ai_request_failure" ||
    now.getTime() - history[0].time >= PRIMARY_COOLDOWN_MS) return active;

  // Activation requires a passing, settled test. Check the selected backup's
  // retained receipt too; an absent or changed receipt never enables failover.
  const tested = await client.from("ai_model_tests").select("profile,result").eq("fingerprint", aiRuntimeFingerprint(backup))
    .eq("result->>passed", "true").order("created_at", { ascending: false }).limit(1);
  if (tested.error) throw new Error("ai_health_unavailable");
  const receipt = tested.data?.[0];
  if (!receipt || receipt.result?.passed !== true || receipt.result?.costState !== "verified") return active;
  const checked = profileSchema.safeParse(receipt.profile);
  if (!checked.success || aiRuntimeFingerprint(checked.data) !== aiRuntimeFingerprint(backup)) return active;
  return backup;
}

/** Resolve once per run; only an absent table or no active profile is legacy. */
export async function loadAiRuntime(client: AiClient, now: Date, spendingBlocked = false): Promise<AiRuntime | null> {
  let policy: AiPolicy | null = null;
  try {
    const configuration = await readAiConfiguration(client);
    if (!configuration?.active) return null;
    policy = configuration.policy;
    const active = profileSchema.parse(configuration.active);
    automationModelSettings(active.modelId, undefined, active);
    const connection = await readAiConnection(client, true);
    if (!connection.configured || !connection.key || connection.version !== active.connectionVersion) {
      return blockedRuntime("ai_connection_changed", policy);
    }
    let profile = active;
    if (!spendingBlocked && policy.recovery === "backup" && configuration.backup) {
      const backup = profileSchema.parse(configuration.backup);
      if (backup.connectionVersion === connection.version) {
        automationModelSettings(backup.modelId, undefined, backup);
        profile = await selectProfile(client, active, backup, now);
      }
    }
    const key = connection.key;
    let failure: string | null = null;
    let succeeded = false;
    let recorded = false;
    const requestCapUsd = policy.requestUsd;
    return {
      profile, policy, blockedReason: spendingBlocked ? "openrouter_circuit_open" : null,
      get failed() { return failure !== null || spendingBlocked; },
      apply(options) {
        return { ...options, configuredModel: profile, apiKey: key,
          llmCallsRemaining: failure || spendingBlocked ? 0 : options.llmCallsRemaining,
          llmBudgetRemainingUsd: Math.min(options.llmBudgetRemainingUsd ?? 0, requestCapUsd),
          onAttempt: async (attempt) => {
            if ((attempt.operation === "extraction" || attempt.operation === "claim_mapping") && attempt.requestStartedAt !== null) {
              if (attempt.outcome === "success") succeeded = true;
              else if (FAILURES.some((code) => code === attempt.outcome)) failure ??= attempt.outcome;
            }
            await options.onAttempt?.(attempt);
          },
        };
      },
      async record(result) {
        if (recorded) return;
        recorded = true;
        const code = result.skips.find((skip) => FAILURES.some((value) => value === skip)) ?? failure;
        // An unrelated source-accounting failure is not a primary model failure.
        // An uncertain settlement also cannot clear prior AI health incidents.
        if (!code && result.skips.some((skip) => ACCOUNTING_FAILURES.includes(skip))) return;
        if (!succeeded && !failure && result.llmCallsUsed === 0) return;
        if (!code && !succeeded && !result.llmSucceeded) return;
        await recordAiEvent(client, code ? "ai_request_failure" : "ai_request_success",
          JSON.stringify({ fingerprint: aiRuntimeFingerprint(profile), code: code ?? "success" }));
      },
    };
  } catch {
    // The fixed reason is visible in the run. Do not leak DB/provider details or
    // let a broken active configuration fall through to environment credentials.
    return blockedRuntime("ai_settings_unavailable", policy);
  }
}
