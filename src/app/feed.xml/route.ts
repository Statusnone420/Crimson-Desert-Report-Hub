import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE, buildAtomXml } from "@/lib/editorialFeed";
import { partialFeedHeaders, readFeedSources } from "@/lib/feedSources.server";

export const dynamic = "force-dynamic";

// Unavailable only when both patch rundowns and editions fail to read.
export async function GET() {
  const { entries, unavailable } = await readFeedSources("atom");
  if (unavailable.length === 2) return new NextResponse("Feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildAtomXml(entries), {
    headers: {
      "content-type": ATOM_CONTENT_TYPE,
      ...partialFeedHeaders(unavailable),
    },
  });
}
