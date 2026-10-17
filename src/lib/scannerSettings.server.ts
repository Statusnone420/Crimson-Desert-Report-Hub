import "server-only";
import { loadMonthSpend } from "@/lib/automation/budgetState.server";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { createServiceClient } from "@/lib/supabase";

export type TavilyMonthUsage = { state: "available"; used: number; pace: number | null } | { state: "unavailable" };

/** Private settings read. Failures disable the affected fields instead of inventing defaults. */
export async function readScannerSettings(now = new Date()) {
  const client = createServiceClient();
  const [control, spend] = await Promise.allSettled([
    getAutomationControlState(client as unknown as AutomationSettingsClient),
    loadMonthSpend(client, now),
  ]);
  let tavilyUsage: TavilyMonthUsage = { state: "unavailable" };
  if (spend.status === "fulfilled") {
    const used = spend.value.tavilyCredits;
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const monthDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const elapsedDays = (now.getTime() - monthStart) / 86_400_000;
    tavilyUsage = { state: "available", used, pace: elapsedDays >= 1 ? Math.round((used / elapsedDays) * monthDays) : null };
  }
  return { control: control.status === "fulfilled" ? control.value : null, tavilyUsage };
}
