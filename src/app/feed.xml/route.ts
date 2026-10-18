import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE, buildAtomXml, editionFeedEntry } from "@/lib/editorialFeed";
import { getPublicEditions } from "@/lib/editorials/store.server";
import { getPatchPublications } from "@/lib/patchPublications.server";

export const dynamic = "force-dynamic";

// A failed read of either source makes the whole feed unavailable, so a partial feed
// never looks complete. Before the column's migration, no editions is not a failure.
export async function GET() {
  const [patches, column] = await Promise.all([getPatchPublications(), getPublicEditions()]);
  if (patches.unavailable || column.unavailable) return new NextResponse("Feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildAtomXml([...patches.articles, ...column.editions.map(editionFeedEntry)]), {
    headers: {
      "content-type": ATOM_CONTENT_TYPE,
    },
  });
}
