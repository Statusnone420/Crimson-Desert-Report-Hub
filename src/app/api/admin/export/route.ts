import { NextResponse } from "next/server";
import { buildCsv } from "@/lib/csv";
import { isAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

const COLUMNS = [
  "id",
  "created_at",
  "patch_version",
  "platform",
  "category",
  "severity",
  "frequency",
  "issue_title",
  "description",
  "repro_steps",
  "expected_behavior",
  "actual_behavior",
  "location_quest",
  "hardware_specs",
  "graphics_mode",
  "driver_os",
  "troubleshooting_tried",
  "pers_id",
  "official_report_submitted",
  "evidence_url",
  "moderation_status",
  "cluster_id",
];

const PAGE_SIZE = 1000;

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  // The hosted API caps one select at 1,000 rows, and the confirm step promises
  // every row. Page in ascending created_at, id order: reports are never
  // hard-deleted and new rows sort after every visited offset, so pages cannot
  // skip or repeat a row mid-export.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("bug_reports")
      .select(COLUMNS.join(","))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const csv = buildCsv(rows, COLUMNS);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cd-reports-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
