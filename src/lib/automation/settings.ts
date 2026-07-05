import "server-only";

import { createServiceClient } from "@/lib/supabase";

export type AutomationControlState = {
  paused: boolean;
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

function settingsClient(client?: AutomationSettingsClient): AutomationSettingsClient {
  return client ?? (createServiceClient() as unknown as AutomationSettingsClient);
}

function isScannerPaused(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "paused" in value && value.paused === true);
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
    paused: isScannerPaused(row?.value),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function setAutomationPaused(client: AutomationSettingsClient, paused: boolean): Promise<void> {
  const { error } = await settingsClient(client).from("automation_settings").upsert(
    {
      key: SCANNER_KEY,
      value: { paused },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`automation settings write failed: ${error.message}`);
}
