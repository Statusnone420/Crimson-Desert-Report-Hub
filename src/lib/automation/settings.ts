import "server-only";

import { MAX_MONTHLY_LLM_USD_CAP } from "@/lib/automation/budget";
import { createServiceClient } from "@/lib/supabase";

const MIN_INTERVAL_MINUTES = [60, 120, 360, 1440] as const;
const SCHEDULED_SEARCH_CREDITS_PER_RUN = [1, 2, 3] as const;
const MODEL_PRESET = "gpt_5_6_luna";
const LEGACY_MODEL_PRESET = "deepseek_v4_flash";
const MAX_MONTHLY_TAVILY_CREDIT_CAP = 1000;

type ScannerMinIntervalMinutes = (typeof MIN_INTERVAL_MINUTES)[number];
type ScannerSearchCreditsPerRun = (typeof SCHEDULED_SEARCH_CREDITS_PER_RUN)[number];
type ScannerModelPreset = typeof MODEL_PRESET | typeof LEGACY_MODEL_PRESET;

export type ScannerPolicy = {
  paused: boolean;
  minIntervalMinutes: ScannerMinIntervalMinutes;
  scheduledSearchCreditsPerRun: ScannerSearchCreditsPerRun;
  monthlyTavilyCreditCap: number;
  monthlyLlmUsdCap: number;
  modelPreset: ScannerModelPreset;
};

export type AutomationControlState = ScannerPolicy & {
  updatedAt: string | null;
};

type SettingsRow = {
  key: string;
  value: unknown;
  updated_at?: string | null;
};

type QueryResult = {
  data: SettingsRow[] | null;
  error: { message: string } | null;
};

type SelectQuery = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): SelectQuery;
  limit(count: number): SelectQuery;
};

type UpsertQuery = PromiseLike<QueryResult>;

export type AutomationSettingsClient = {
  from(table: "automation_settings"): {
    select(columns?: string): SelectQuery;
    upsert(row: SettingsRow, options?: { onConflict?: string }): UpsertQuery;
  };
};

const SCANNER_KEY = "scanner";
const DEFAULT_SCANNER_POLICY: ScannerPolicy = {
  paused: false,
  minIntervalMinutes: 60,
  scheduledSearchCreditsPerRun: 1,
  monthlyTavilyCreditCap: 1000,
  monthlyLlmUsdCap: MAX_MONTHLY_LLM_USD_CAP,
  modelPreset: MODEL_PRESET,
};

function settingsClient(client?: AutomationSettingsClient): AutomationSettingsClient {
  return client ?? (createServiceClient() as unknown as AutomationSettingsClient);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function oneOfNumber<T extends readonly number[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const parsed = numberValue(value);
  return allowed.includes(parsed as T[number]) ? (parsed as T[number]) : fallback;
}

function monthlyTavilyCreditCap(value: unknown): number {
  const parsed = numberValue(value);
  return parsed === null || parsed < 0
    ? DEFAULT_SCANNER_POLICY.monthlyTavilyCreditCap
    : Math.min(Math.floor(parsed), MAX_MONTHLY_TAVILY_CREDIT_CAP);
}

function monthlyLlmUsdCap(value: unknown): number {
  const parsed = numberValue(value);
  if (parsed === null || parsed < 0) return DEFAULT_SCANNER_POLICY.monthlyLlmUsdCap;
  return Math.min(parsed, MAX_MONTHLY_LLM_USD_CAP);
}

export function normalizeScannerPolicy(value: unknown): ScannerPolicy {
  const settings = recordValue(value);
  return {
    paused: settings.paused === true || settings.paused === "true",
    minIntervalMinutes: oneOfNumber(
      settings.minIntervalMinutes,
      MIN_INTERVAL_MINUTES,
      DEFAULT_SCANNER_POLICY.minIntervalMinutes,
    ),
    scheduledSearchCreditsPerRun: oneOfNumber(
      settings.scheduledSearchCreditsPerRun,
      SCHEDULED_SEARCH_CREDITS_PER_RUN,
      DEFAULT_SCANNER_POLICY.scheduledSearchCreditsPerRun,
    ),
    monthlyTavilyCreditCap: monthlyTavilyCreditCap(settings.monthlyTavilyCreditCap),
    monthlyLlmUsdCap: monthlyLlmUsdCap(settings.monthlyLlmUsdCap),
    // This hidden UI field never chose a provider. Normalize the old one-value
    // DeepSeek setting to the new default without touching pause, cadence, or
    // either budget field in a saved policy.
    modelPreset:
      settings.modelPreset === MODEL_PRESET || settings.modelPreset === LEGACY_MODEL_PRESET
        ? MODEL_PRESET
        : DEFAULT_SCANNER_POLICY.modelPreset,
  };
}

export function scannerPolicyFromFormData(formData: FormData): ScannerPolicy {
  const cadence = formData.get("cadence");
  return normalizeScannerPolicy({
    paused: cadence === "paused" ? true : (formData.get("paused") ?? (cadence ? "false" : null)),
    minIntervalMinutes: cadence && cadence !== "paused" ? cadence : formData.get("minIntervalMinutes"),
    scheduledSearchCreditsPerRun: formData.get("scheduledSearchCreditsPerRun"),
    monthlyTavilyCreditCap: formData.get("monthlyTavilyCreditCap"),
    monthlyLlmUsdCap: formData.get("monthlyLlmUsdCap"),
    modelPreset: formData.get("modelPreset"),
  });
}

export async function getAutomationControlState(
  client?: AutomationSettingsClient,
): Promise<AutomationControlState> {
  const { data, error } = await settingsClient(client)
    .from("automation_settings")
    .select("value, updated_at")
    .eq("key", SCANNER_KEY)
    .limit(1);
  if (error) throw new Error(`automation settings read failed: ${error.message}`);

  const row = data?.[0] ?? null;
  return {
    ...normalizeScannerPolicy(row?.value),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function setScannerPolicy(client: AutomationSettingsClient, policy: unknown): Promise<void> {
  const { error } = await settingsClient(client).from("automation_settings").upsert(
    {
      key: SCANNER_KEY,
      value: normalizeScannerPolicy(policy),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`automation settings write failed: ${error.message}`);
}

export async function setAutomationPaused(client: AutomationSettingsClient, paused: boolean): Promise<void> {
  const policy = await getAutomationControlState(client);
  await setScannerPolicy(client, { ...policy, paused });
}
