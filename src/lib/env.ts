import { DEFAULT_MONTHLY_LLM_USD_CAP, MAX_MONTHLY_LLM_USD_CAP, resolveAutomationOpenRouterModel } from "@/lib/automation/budget";

type EnvLike = Record<string, string | undefined>;

export type Features = {
  turnstile: boolean;
  ai: boolean;
  xSearch: boolean;
  webSearch: boolean;
  automation: boolean;
};

function hasEnvValue(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && trimmed !== "\"\"" && trimmed !== "''");
}

function hasApprovedAutomationModel(env: EnvLike): boolean {
  try {
    resolveAutomationOpenRouterModel(env.OPENROUTER_AUTOMATION_MODEL);
    return true;
  } catch {
    return false;
  }
}

export function computeFeatures(env: EnvLike): Features {
  const webSearch = hasEnvValue(env.TAVILY_API_KEY);
  const ai = hasEnvValue(env.OPENROUTER_API_KEY) && hasApprovedAutomationModel(env);

  return {
    turnstile: hasEnvValue(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && hasEnvValue(env.TURNSTILE_SECRET_KEY),
    ai,
    xSearch: hasEnvValue(env.XAI_API_KEY),
    webSearch,
    automation: webSearch,
  };
}

export type IntegrationStatus = {
  key: "web_search" | "ai_extraction";
  label: string;
  connected: boolean;
  missingEnv: string[];
  detail: string;
  /** Configured but temporarily off — e.g. the OpenRouter cost-safety circuit is open. */
  paused?: boolean;
  /** Configured, but the circuit read failed: neither known running nor known paused. */
  circuitUnknown?: boolean;
};

/**
 * Env vars only say what is configured; the safety circuit says what is running.
 * When the circuit is open, the AI extraction card must not claim to be extracting.
 *
 * `null` means the circuit read failed. The engine fails closed on that — a spend
 * decision — but a status card must not turn "we could not read it" into the
 * specific claim that the circuit is open, so it reports unknown instead.
 */
export function applyLlmCircuitToStatuses(
  statuses: IntegrationStatus[],
  llmPaused: boolean | null,
): IntegrationStatus[] {
  if (llmPaused === false) return statuses;
  return statuses.map((status) =>
    status.key === "ai_extraction" && status.connected
      ? llmPaused === null
        ? {
            ...status,
            circuitUnknown: true,
            detail:
              "The cost-safety circuit read failed, so this page cannot say whether scans are using LLM extraction right now.",
          }
        : {
            ...status,
            paused: true,
            detail: "The cost-safety circuit is open, so scans run without LLM extraction until it clears.",
          }
      : status,
  );
}

export function integrationStatuses(env: EnvLike = process.env): IntegrationStatus[] {
  const webSearchConnected = hasEnvValue(env.TAVILY_API_KEY);

  // Scanner AI is intentionally limited to the approved automation models.
  const hasOpenRouterKey = hasEnvValue(env.OPENROUTER_API_KEY);
  const approvedAutomationModel = hasApprovedAutomationModel(env);
  const aiConnected = hasOpenRouterKey && approvedAutomationModel;
  const aiMissing = !hasOpenRouterKey
    ? ["OPENROUTER_API_KEY"]
    : approvedAutomationModel
      ? []
      : ["OPENROUTER_AUTOMATION_MODEL"];

  return [
    {
      key: "web_search",
      label: "Web search (Tavily)",
      connected: webSearchConnected,
      missingEnv: webSearchConnected ? [] : ["TAVILY_API_KEY"],
      detail: webSearchConnected
        ? "Discovering public sources via Tavily."
        : "Not connected — the scanner cannot discover new public sources.",
    },
    {
      key: "ai_extraction",
      label: "AI extraction (OpenRouter)",
      connected: aiConnected,
      missingEnv: aiMissing,
      detail: aiConnected
        ? "Reads each candidate page for what broke and on which platform. It never decides what gets published."
        : hasOpenRouterKey && !approvedAutomationModel
          ? "Not connected — the configured automation model is not approved."
          : "Not connected — falling back to deterministic keyword extraction.",
    },
  ];
}

export function automationBudgetUsd(env: EnvLike = process.env): number {
  const raw = env.AUTOMATION_BUDGET_USD_MONTHLY?.trim();
  if (!raw) return DEFAULT_MONTHLY_LLM_USD_CAP;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_MONTHLY_LLM_USD_CAP);
}

/** Explicit rollout switch for the keyless Steam review/pulse lane. */
export function steamPulseEnabled(env: EnvLike = process.env): boolean {
  return env.STEAM_PULSE_ENABLED?.trim().toLowerCase() === "true";
}

/** Separate, default-off rollout switch for aggregate Steam player readings. */
export function steamPlayerCountsEnabled(env: EnvLike = process.env): boolean {
  return env.STEAM_PLAYER_COUNTS_ENABLED?.trim().toLowerCase() === "true";
}

/** Server-only Twitch application credentials power both IGDB and live context. */
export function platformContextConfigured(env: EnvLike = process.env): boolean {
  return hasEnvValue(env.TWITCH_CLIENT_ID) && hasEnvValue(env.TWITCH_CLIENT_SECRET);
}

export function features(): Features {
  return computeFeatures(process.env);
}

export function requiredEnv(
  name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "ADMIN_PASSWORD" | "SESSION_SECRET",
): string {
  const value = process.env[name]?.trim();
  if (value === "\"\"" || value === "''") throw new Error(`Missing required env var: ${name}`);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
