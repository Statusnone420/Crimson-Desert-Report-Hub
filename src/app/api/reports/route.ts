import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { reportFingerprint, hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { moderateReport, type ClusterRef } from "@/lib/moderation";
import { reportSchema } from "@/lib/reportSchema";
import { createServiceClient } from "@/lib/supabase";
import { verifyTurnstile } from "@/lib/turnstile";

const MAX_PER_HOUR = 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const captcha = await verifyTurnstile(parsed.data.turnstile_token, ip);
  if (!captcha.ok) {
    return NextResponse.json({ error: "captcha_failed" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const ipHash = ip ? hashIp(ip, requiredEnv("SESSION_SECRET")) : null;

  if (ipHash) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("bug_reports")
      .select("id", { count: "exact", head: true })
      .eq("submitter_ip_hash", ipHash)
      .gte("created_at", oneHourAgo);
    if (countError) return NextResponse.json({ error: "rate_check_failed" }, { status: 500 });
    if ((count ?? 0) >= MAX_PER_HOUR) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }

  const report = { ...parsed.data };
  delete report.turnstile_token;

  const { data: clusterData } = await supabase.from("issue_clusters").select("id, title, category");
  const decision = await moderateReport(
    {
      issueTitle: report.issue_title,
      description: report.description,
      category: report.category,
      platform: report.platform,
      severity: report.severity,
      frequency: report.frequency,
    },
    (clusterData ?? []) as ClusterRef[],
  );

  const { data: inserted, error } = await supabase
    .from("bug_reports")
    .insert({
      ...report,
      moderation_status: decision.status,
      cluster_id: decision.clusterId,
      duplicate_fingerprint: reportFingerprint(report.category, report.platform, report.issue_title),
      submitter_ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (error || !inserted) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  // The neutral excerpt is a nice-to-have; its failure must never turn an
  // already-persisted report into an error response (client would resubmit).
  if (decision.status === "approved" && decision.publicSummary) {
    try {
      const { error: excerptError } = await supabase
        .from("approved_excerpts")
        .insert({ report_id: inserted.id, excerpt_text: decision.publicSummary.slice(0, 500) });
      if (excerptError) console.error(`approved excerpt insert failed: ${excerptError.message}`);
    } catch (excerptError) {
      console.error("approved excerpt insert failed:", excerptError);
    }
  }

  revalidateTag(PUBLIC_DASHBOARD_TAG, "max");
  revalidateTag(PUBLIC_ISSUES_TAG, "max");
  return NextResponse.json({ ok: true }, { status: 201 });
}
