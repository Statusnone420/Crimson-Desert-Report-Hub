import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSupabaseRelation, isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import type { ProblemReport, ProblemReportStatus } from "@/lib/problemReports";

// Deliberately exclude the rate-limit hash from inbox and agent responses.
const REVIEW_FIELDS = "id,created_at,updated_at,type,description,page_url,email,status,revision,private_notes";

export class ProblemReportsUnavailable extends Error {
  constructor(public readonly reason: "schema_missing" | "read_failed" | "write_failed") { super(reason); }
}

export async function listProblemReports(client: SupabaseClient, options: { status?: ProblemReportStatus; offset?: number } = {}) {
  const offset = options.offset ?? 0;
  let query = client.from("site_problem_reports").select(REVIEW_FIELDS)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (options.status) query = query.eq("status", options.status);
  const { data, error } = await query.range(offset, offset + 50);
  if (error) throw new ProblemReportsUnavailable(isMissingSupabaseRelation(error, "site_problem_reports") ? "schema_missing" : "read_failed");
  const rows = (data ?? []) as ProblemReport[];
  return { reports: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null };
}

export async function readProblemReport(client: SupabaseClient, id: string): Promise<ProblemReport | null> {
  const { data, error } = await client.from("site_problem_reports").select(REVIEW_FIELDS).eq("id", id).maybeSingle();
  if (error) throw new ProblemReportsUnavailable(isMissingSupabaseRelation(error, "site_problem_reports") ? "schema_missing" : "read_failed");
  return data as ProblemReport | null;
}

export async function updateProblemReport(client: SupabaseClient, id: string, revision: number, status?: ProblemReportStatus, note?: string) {
  const { data, error } = await client.rpc("review_site_problem_report", {
    p_id: id, p_expected_revision: revision, p_status: status ?? null, p_note: note ?? null,
  });
  if (error) throw new ProblemReportsUnavailable(isMissingSupabaseRpc(error, "review_site_problem_report") ? "schema_missing" : "write_failed");
  return data as { outcome: "updated" | "not_found" | "conflict"; revision?: number; updated_at?: string };
}
