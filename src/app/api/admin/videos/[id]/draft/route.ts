import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { ownerAttentionPrivateHeaders } from "@/lib/ownerAttentionBrief";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { readPublicationDraft } from "@/lib/videoReviewStore";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const headers = ownerAttentionPrivateHeaders();
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "bad input" }, { status: 400, headers });
  if (!hasSupabaseServiceConfig()) {
    return NextResponse.json({ error: "unavailable", reason: "schema_missing" }, { status: 503, headers });
  }
  const draft = await readPublicationDraft(createServiceClient(), id);
  if ("status" in draft) {
    return NextResponse.json({ error: "unavailable", reason: draft.reason }, { status: 503, headers });
  }
  return new NextResponse(draft.markdown, {
    status: 200,
    headers: {
      ...headers,
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="video-publication-draft-${draft.video_id}.md"`,
    },
  });
}
