import { NextResponse } from "next/server";
import { buildRssXml, RSS_CONTENT_TYPE } from "@/lib/editorialFeed";
import { getPatchPublications } from "@/lib/patchPublications.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { articles, unavailable } = await getPatchPublications();
  if (unavailable) return new NextResponse("Patch feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildRssXml(articles), {
    headers: {
      "content-type": RSS_CONTENT_TYPE,
    },
  });
}
