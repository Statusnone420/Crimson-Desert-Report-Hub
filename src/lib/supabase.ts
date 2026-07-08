import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

function hasEnvValue(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && trimmed !== "\"\"" && trimmed !== "''");
}

export function hasSupabaseServiceConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasEnvValue(env.SUPABASE_URL) && hasEnvValue(env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Server-only. Never import from a client component. */
export function createServiceClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
