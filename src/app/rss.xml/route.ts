import { NextResponse } from "next/server";
import { buildRssXml, RSS_CONTENT_TYPE } from "@/lib/editorialFeed";

export const dynamic = "force-static";

export function GET() {
  return new NextResponse(buildRssXml(), {
    headers: {
      "content-type": RSS_CONTENT_TYPE,
    },
  });
}
