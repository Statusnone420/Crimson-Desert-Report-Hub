import { NextResponse } from "next/server";

/** The public written-report intake is permanently retired. */
export function POST() {
  return NextResponse.json({ error: "reports_retired" }, { status: 410 });
}
