import { NextResponse } from "next/server";
import { buildRssXml, RSS_CONTENT_TYPE } from "@/lib/editorialFeed";
import { partialFeedHeaders, readFeedSources } from "@/lib/feedSources.server";

export const dynamic = "force-dynamic";

// Unavailable only when both patch rundowns and editions fail to read.
export async function GET() {
  const { entries, unavailable } = await readFeedSources("rss");
  if (unavailable.length === 2) return new NextResponse("Feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildRssXml(entries), {
    headers: {
      "content-type": RSS_CONTENT_TYPE,
      ...partialFeedHeaders(unavailable),
    },
  });
}
