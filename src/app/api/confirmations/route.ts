import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { CONFIRMATION_KINDS } from "@/lib/confirmations";
import { PLATFORMS } from "@/lib/constants";
import { hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { isCurrentPatchVerified } from "@/lib/patchWatch";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import { verifyTurnstile } from "@/lib/turnstile";

const confirmationSchema = z.object({
  cluster_id: z.uuid(),
  patch_version: z.string().trim().min(1).max(20),
  platform: z.enum(PLATFORMS),
  kind: z.enum(CONFIRMATION_KINDS),
  turnstile_token: z.string().min(1).max(2048),
});

function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (isVercelPreview()) {
    return NextResponse.json({ error: "preview_writes_disabled" }, { status: 403 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_site_rejected" }, { status: 403 });
  }
  if (req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = confirmationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  if (!hasSupabaseServiceConfig()) {
    return NextResponse.json({ error: "current_patch_unavailable" }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (!ip) {
    // One-voice dedup keys on the network hash; an unattributable tap can't be counted.
    return NextResponse.json({ error: "no_client_ip" }, { status: 400 });
  }

  const captcha = await verifyTurnstile(parsed.data.turnstile_token, ip);
  if (captcha.skipped) {
    return NextResponse.json({ error: "turnstile_unavailable" }, { status: 503 });
  }
  if (!captcha.ok) {
    return NextResponse.json({ error: "captcha_failed" }, { status: 400 });
  }

  const voterIpHash = hashIp(ip, requiredEnv("SESSION_SECRET"));

  const supabase = createServiceClient();

  const currentPatch = await getCurrentPatchMetadata(supabase);
  if (!isCurrentPatchVerified(currentPatch)) {
    return NextResponse.json({ error: "current_patch_unavailable" }, { status: 503 });
  }
  if (parsed.data.patch_version !== currentPatch.version) {
    return NextResponse.json({ error: "stale_patch" }, { status: 409 });
  }

  const { data: outcome, error: recordError } = await supabase.rpc("record_issue_checkin", {
    p_cluster_id: parsed.data.cluster_id,
    p_patch_version: currentPatch.version,
    p_platform: parsed.data.platform,
    p_kind: parsed.data.kind,
    p_voter_ip_hash: voterIpHash,
  });
  if (recordError) {
    if (isMissingSupabaseRpc(recordError, "record_issue_checkin")) {
      return NextResponse.json({ error: "checkins_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  }
  if (outcome === "unknown_issue") return NextResponse.json({ error: "unknown_issue" }, { status: 404 });
  if (outcome === "stale_patch") return NextResponse.json({ error: "stale_patch" }, { status: 409 });
  if (outcome === "current_patch_unavailable") {
    return NextResponse.json({ error: "current_patch_unavailable" }, { status: 503 });
  }
  if (outcome === "rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (outcome === "claim_context_unavailable") {
    return NextResponse.json({ error: "claim_context_unavailable" }, { status: 503 });
  }
  if (outcome === "claim_required") return NextResponse.json({ error: "claim_required" }, { status: 409 });
  if (outcome !== "recorded") return NextResponse.json({ error: "confirm_failed" }, { status: 500 });

  revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
  revalidateTag(PUBLIC_ISSUES_TAG, "max");
  return NextResponse.json({
    ok: true,
    kind: parsed.data.kind,
    platform: parsed.data.platform,
    patch_version: currentPatch.version,
  }, { status: 201 });
}
