import { NextResponse } from "next/server";
import { previewAutomationSearch } from "@/lib/automation/preview";

const MAX_PREVIEW_QUERIES = 2;

function requestedQueries(req: Request): number {
  const raw = Number(new URL(req.url).searchParams.get("queries") ?? "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(MAX_PREVIEW_QUERIES, Math.trunc(raw)));
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "cron secret missing" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const preview = await previewAutomationSearch({ maxQueries: requestedQueries(req) });
  return NextResponse.json({ ok: true, preview });
}
