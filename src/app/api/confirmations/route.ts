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

const MAX_PER_HOUR = 20;

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
  if (!origin) return true;
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

  const { data: clusterRows, error: clusterError } = await supabase
    .from("issue_clusters")
    .select("id")
    .eq("id", parsed.data.cluster_id)
    .eq("is_public", true)
    .limit(1);
  if (clusterError) return NextResponse.json({ error: "cluster_check_failed" }, { status: 500 });
  if (!clusterRows || clusterRows.length === 0) {
    return NextResponse.json({ error: "unknown_issue" }, { status: 404 });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("issue_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("voter_ip_hash", voterIpHash)
    .gte("created_at", oneHourAgo);
  if (countError) return NextResponse.json({ error: "rate_check_failed" }, { status: 500 });
  if ((count ?? 0) >= MAX_PER_HOUR) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const currentPatch = await getCurrentPatchMetadata(supabase);
  const patchFamily = patchFamilyKey(currentPatch.version) ?? currentPatch.version;

  // created_at is set explicitly so a stance change refreshes the poll-window clock —
  // the DB default only applies on first insert, not on conflict-update.
  const { error: upsertError } = await supabase.from("issue_confirmations").upsert(
    {
      cluster_id: parsed.data.cluster_id,
      patch_family: patchFamily,
      patch_version: currentPatch.version,
      platform: parsed.data.platform,
      kind: parsed.data.kind,
      voter_ip_hash: voterIpHash,
      created_at: new Date().toISOString(),
    },
    { onConflict: "cluster_id,patch_family,voter_ip_hash" },
  );
  if (upsertError) return NextResponse.json({ error: "confirm_failed" }, { status: 500 });

  revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
  revalidateTag(PUBLIC_ISSUES_TAG, "max");
  return NextResponse.json({ ok: true }, { status: 201 });
}
