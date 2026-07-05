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

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("bug_reports")
    .select(COLUMNS.join(","))
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });

  const csv = buildCsv((data ?? []) as unknown as Record<string, unknown>[], COLUMNS);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cd-reports-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
