import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { listProblemReports, readProblemReport, updateProblemReport } from "@/lib/problemReports.server";

function fixture(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), order: vi.fn(), eq: vi.fn(), range: vi.fn(), maybeSingle: vi.fn() };
  for (const method of [query.select, query.order, query.eq]) method.mockReturnValue(query);
  query.range.mockResolvedValue({ data, error }); query.maybeSingle.mockResolvedValue({ data, error });
  const from = vi.fn().mockReturnValue(query);
  return { query, from, client: { from } as unknown as SupabaseClient };
}
it("selects review fields explicitly and never exposes the IP hash", async () => {
  const { client, query } = fixture(Array.from({ length: 51 }, (_, i) => ({ id: String(i) })));
  const result = await listProblemReports(client, { offset: 50, status: "new" });
  expect(result.reports).toHaveLength(50); expect(result.nextOffset).toBe(100);
  expect(query.range).toHaveBeenCalledWith(50, 100); expect(query.eq).toHaveBeenCalledWith("status", "new");
  expect(query.select.mock.calls[0][0]).not.toMatch(/ip_hash|\*/);
  await readProblemReport(client, "id"); expect(query.select.mock.calls[1][0]).not.toContain("ip_hash");
});
it("distinguishes a missing migration from permissions and other read failures", async () => {
  await expect(listProblemReports(fixture(null, { code: "PGRST205", message: "site_problem_reports not found in schema cache" }).client)).rejects.toMatchObject({ reason: "schema_missing" });
  await expect(listProblemReports(fixture(null, { code: "42501", message: "permission denied for site_problem_reports" }).client)).rejects.toMatchObject({ reason: "read_failed" });
});
it("sends only queue bookkeeping to the review RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { outcome: "updated", revision: 1 }, error: null });
  await updateProblemReport({ rpc } as unknown as SupabaseClient, "id", 0, "approved", "Private note");
  expect(rpc).toHaveBeenCalledWith("review_site_problem_report", { p_id: "id", p_expected_revision: 0, p_status: "approved", p_note: "Private note" });
});
