import "server-only";
import { createHmac } from "node:crypto";
import { ipNetwork } from "@/lib/crypto";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

function addressIdentity(req: Request): string {
  // Vercel overwrites x-forwarded-for. Other hosts share an unattributed bucket;
  // arbitrary forwarding headers must not create trusted identities.
  if (process.env.VERCEL !== "1") return "unattributed";
  return ipNetwork(req.headers.get("x-forwarded-for")?.trim() ?? "") ?? "unattributed";
}

export async function reserveLoginAttempt(req: Request, secret: string): Promise<
  { allowed: true } | { allowed: false; retryAfter: number } | null
> {
  if (!hasSupabaseServiceConfig()) return null;
  const addressHash = createHmac("sha256", secret)
    .update(`admin-login:${addressIdentity(req)}`).digest("hex");
  try {
    const { data, error } = await createServiceClient()
      .rpc("reserve_admin_login_attempt", { p_address_hash: addressHash })
      .abortSignal(AbortSignal.timeout(5_000));
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
    if (data.allowed === true && data.retry_after === 0) return { allowed: true };
    if (data.allowed === false && Number.isInteger(data.retry_after) && data.retry_after >= 1 && data.retry_after <= 900) {
      return { allowed: false, retryAfter: data.retry_after };
    }
  } catch {
    // Database failures never permit a comparison or expose request details.
  }
  return null;
}

export async function readLoginPassword(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const password = (body as Record<string, unknown>).password;
    // Preserve exact bytes: whitespace and Unicode are valid password content.
    return typeof password === "string" && password.length > 0 && Buffer.byteLength(password, "utf8") <= 1024
      ? password : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
