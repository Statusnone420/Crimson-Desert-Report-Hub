import "server-only";

import { cache } from "react";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

function generationFrom(data: unknown): number | null {
  return typeof data === "number" && Number.isSafeInteger(data) && data >= 1 ? data : null;
}

/**
 * The current admin login generation, read once per request. Null when it
 * cannot be read; callers then refuse admin access rather than guess.
 */
export const currentSessionGeneration = cache(async (): Promise<number | null> => {
  if (!hasSupabaseServiceConfig()) return null;
  try {
    const { data, error } = await createServiceClient()
      .rpc("admin_session_generation")
      .abortSignal(AbortSignal.timeout(5_000));
    return error ? null : generationFrom(data);
  } catch {
    return null;
  }
});

/** Ends every admin session by moving to the next generation. Returns it, or null on failure. */
export async function revokeAdminSessions(): Promise<number | null> {
  if (!hasSupabaseServiceConfig()) return null;
  try {
    const { data, error } = await createServiceClient()
      .rpc("revoke_admin_sessions")
      .abortSignal(AbortSignal.timeout(5_000));
    return error ? null : generationFrom(data);
  } catch {
    return null;
  }
}
