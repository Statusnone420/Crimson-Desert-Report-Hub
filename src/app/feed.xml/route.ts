import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE, buildAtomXml, editionFeedEntry } from "@/lib/editorialFeed";
import { getPublicEditions } from "@/lib/editorials/store.server";
import { getPatchPublications } from "@/lib/patchPublications.server";

export const dynamic = "force-dynamic";

// Patch rundowns and column editions are read separately: either one failing still
// serves the other. Only when both reads fail is the feed unavailable.
export async function GET() {
  const [patches, column] = await Promise.all([getPatchPublications(), getPublicEditions()]);
  if (patches.unavailable && column.unavailable) return new NextResponse("Feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildAtomXml([...patches.articles, ...column.editions.map(editionFeedEntry)]), {
    headers: {
      "content-type": ATOM_CONTENT_TYPE,
    },
  });
}
