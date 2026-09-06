import { NextResponse } from "next/server";
import { ATOM_CONTENT_TYPE, buildAtomXml } from "@/lib/editorialFeed";

export const dynamic = "force-static";

export function GET() {
  return new NextResponse(buildAtomXml(), {
    headers: {
      "content-type": ATOM_CONTENT_TYPE,
    },
  });
}
