import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { CONFIRMATION_KINDS } from "@/lib/confirmations";
import { PLATFORMS } from "@/lib/constants";
import { hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";

const confirmationSchema = z.object({
  cluster_id: z.uuid(),
  platform: z.enum(PLATFORMS),
  kind: z.enum(CONFIRMATION_KINDS),
});

// No captcha on this path: enum-only payload, one voice per network, rate limit, and
// display thresholds bound the blast radius. Cross-site posts are refused outright.
function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (!ip) {
    // One-voice dedup keys on the network hash; an unattributable tap can't be counted.
    return NextResponse.json({ error: "no_client_ip" }, { status: 400 });
  }
  const voterIpHash = hashIp(ip, requiredEnv("SESSION_SECRET"));

  const supabase = createServiceClient();

  const currentPatch = await getCurrentPatchMetadata(supabase);
  const patchFamily = patchFamilyKey(currentPatch.version) ?? currentPatch.version;

  const { data: outcome, error: recordError } = await supabase.rpc("record_issue_confirmation", {
    p_cluster_id: parsed.data.cluster_id,
    p_patch_family: patchFamily,
    p_patch_version: currentPatch.version,
    p_platform: parsed.data.platform,
    p_kind: parsed.data.kind,
    p_voter_ip_hash: voterIpHash,
  });
  if (recordError) return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  if (outcome === "unknown_issue") return NextResponse.json({ error: "unknown_issue" }, { status: 404 });
  if (outcome === "rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (outcome !== "recorded") return NextResponse.json({ error: "confirm_failed" }, { status: 500 });

  revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
  revalidateTag(PUBLIC_ISSUES_TAG, "max");
  return NextResponse.json({ ok: true }, { status: 201 });
}
