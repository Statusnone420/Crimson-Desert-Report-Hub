import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error: touchError } = await supabase.from("issue_clusters").select("id").limit(1);
  const { error: purgeError } = await supabase
    .from("source_signals")
    .update({ raw_text: null, raw_expires_at: null })
    .lt("raw_expires_at", new Date().toISOString())
    .not("raw_text", "is", null);

  return NextResponse.json({
    ok: !touchError && !purgeError,
    touch: touchError?.message ?? "ok",
    purge: purgeError?.message ?? "ok",
  });
}
