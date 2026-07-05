import { NextResponse } from "next/server";
import { reportFingerprint, hashIp } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
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

  const { turnstile_token: _drop, ...report } = parsed.data;
  const { error } = await supabase.from("bug_reports").insert({
    ...report,
    moderation_status: "pending",
    duplicate_fingerprint: reportFingerprint(report.category, report.platform, report.issue_title),
    submitter_ip_hash: ipHash,
  });
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
