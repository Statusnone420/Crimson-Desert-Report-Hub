import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE, buildAtomXml } from "@/lib/editorialFeed";
import { getPatchPublications } from "@/lib/patchPublications.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { articles, unavailable } = await getPatchPublications();
  if (unavailable) return new NextResponse("Patch feed temporarily unavailable", { status: 503, headers: { "Retry-After": "300" } });
  return new NextResponse(buildAtomXml(articles), {
    headers: {
      "content-type": ATOM_CONTENT_TYPE,
    },
  });
}
