import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { ownerAttentionPrivateHeaders, readOwnerAttentionBrief } from "@/lib/ownerAttentionBrief";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = ownerAttentionPrivateHeaders();
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (!hasSupabaseServiceConfig()) {
    return NextResponse.json(
      {
        observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        status: "unavailable",
        unavailableReason: "read_failed",
        videoInbox: null,
        adminAttention: null,
      },
      { status: 503, headers },
    );
  }
  const brief = await readOwnerAttentionBrief(createServiceClient());
  const status = brief.status === "ok" ? 200 : brief.status === "unavailable" ? 503 : 500;
  return NextResponse.json(brief, { status, headers });
}
