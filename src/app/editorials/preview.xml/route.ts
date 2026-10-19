import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE } from "@/lib/editorialFeed";
import { buildPreviewAtomXml } from "@/lib/editorials/previewFeed";
import { readPreviewEditions } from "@/lib/editorials/store.server";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Private drafts: never indexed, never cached, never listed in the sitemap or robots.
const PRIVATE_HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "private, no-store" };

/** Both sides are hashed to one length first, so the comparison takes the same time whatever was sent. */
function matchesPreviewToken(supplied: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

export async function GET(req: Request) {
  const expected = process.env.COLUMN_PREVIEW_TOKEN?.trim();
  if (!expected) return new NextResponse("Not found", { status: 404, headers: PRIVATE_HEADERS });
  const supplied = new URL(req.url).searchParams.get("token") ?? "";
  if (!matchesPreviewToken(supplied, expected)) return new NextResponse("Unauthorized", { status: 401, headers: PRIVATE_HEADERS });
  if (!hasSupabaseServiceConfig()) return new NextResponse("Preview temporarily unavailable", { status: 503, headers: PRIVATE_HEADERS });
  const now = new Date();
  try {
    const rows = await readPreviewEditions(createServiceClient(), now);
    return new NextResponse(buildPreviewAtomXml(rows, now), { headers: { ...PRIVATE_HEADERS, "content-type": ATOM_CONTENT_TYPE } });
  } catch {
    return new NextResponse("Preview temporarily unavailable", { status: 503, headers: PRIVATE_HEADERS });
  }
}
