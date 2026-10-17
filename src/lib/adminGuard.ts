import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/session";

export function adminSessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.SESSION_SECRET?.trim();
  if (!value || value === "\"\"" || value === "''") return null;
  return value;
}

export async function isAdmin(): Promise<boolean> {
  const secret = adminSessionSecret();
  if (!secret) return false;
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value, secret);
}

/**
 * Pages pass their own path so an expired session returns the operator to the
 * page they were headed to after sign-in. Server actions call this bare — a
 * mid-action expiry has no page to go back to.
 */
export async function requireAdmin(returnTo?: string): Promise<void> {
  if (!(await isAdmin())) {
    redirect(returnTo ? `/admin/login?from=${encodeURIComponent(returnTo)}` : "/admin/login");
  }
}
