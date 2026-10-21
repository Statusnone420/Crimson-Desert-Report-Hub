import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { isCurrentPatchVerified } from "@/lib/patchWatch";
import { isVercelPreview } from "@/lib/previewGuard";
import { isSameOriginRequest, requestNetwork } from "@/lib/publicWrite.server";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import { THUMB_DIRECTIONS } from "@/lib/thumbs";
import { verifyTurnstile } from "@/lib/turnstile";

const thumbSchema = z.object({
  cluster_id: z.uuid(),
  patch_version: z.string().trim().min(1).max(20),
  // "none" takes the network's thumb back.
  direction: z.enum([...THUMB_DIRECTIONS, "none"]),
  turnstile_token: z.string().min(1).max(2048),
});

const OUTCOME_ERRORS = new Map<unknown, [string, number]>([
  // Siteverify accepts a reused token, so the database refuses it instead.
  ["replayed", ["captcha_failed", 400]],
  ["unknown_issue", ["unknown_issue", 404]],
  ["stale_patch", ["stale_patch", 409]],
  ["current_patch_unavailable", ["current_patch_unavailable", 503]],
  ["rate_limited", ["rate_limited", 429]],
]);

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Saves, switches or takes back one thumb. The reply carries no count: thumbs are never shown. */
export async function POST(req: Request) {
  if (isVercelPreview()) return reply({ error: "preview_writes_disabled" }, 403);
  if (!isSameOriginRequest(req)) return reply({ error: "cross_site_rejected" }, 403);
  if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return reply({ error: "json_required" }, 415);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "invalid_json" }, 400);
  }
  const parsed = thumbSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "validation" }, 400);
  if (!hasSupabaseServiceConfig()) return reply({ error: "thumbs_unavailable" }, 503);

  const client = requestNetwork(req);
  // One thumb per network: a tap without a network cannot be deduplicated.
  if (!client) return reply({ error: "no_client_ip" }, 400);

  const captcha = await verifyTurnstile(parsed.data.turnstile_token, client.ip);
  if (captcha.skipped) return reply({ error: "turnstile_unavailable" }, 503);
  if (!captcha.ok) return reply({ error: "captcha_failed" }, 400);

  const supabase = createServiceClient();
  const currentPatch = await getCurrentPatchMetadata(supabase);
  if (!isCurrentPatchVerified(currentPatch)) return reply({ error: "current_patch_unavailable" }, 503);
  if (parsed.data.patch_version !== currentPatch.version) return reply({ error: "stale_patch" }, 409);

  const { data: outcome, error } = await supabase.rpc("record_issue_thumb", {
    p_cluster_id: parsed.data.cluster_id,
    p_patch_version: currentPatch.version,
    p_direction: parsed.data.direction,
    p_voter_ip_hash: hashIp(client.network, requiredEnv("SESSION_SECRET")),
    p_token_hash: createHash("sha256").update(parsed.data.turnstile_token).digest("hex"),
  });
  if (error) {
    if (isMissingSupabaseRpc(error, "record_issue_thumb")) return reply({ error: "thumbs_unavailable" }, 503);
    return reply({ error: "thumb_failed" }, 500);
  }
  if (outcome === "recorded") {
    return reply({ ok: true, direction: parsed.data.direction, patch_version: currentPatch.version }, 200);
  }
  const [code, status] = OUTCOME_ERRORS.get(outcome) ?? ["thumb_failed", 500];
  return reply({ error: code }, status);
}
