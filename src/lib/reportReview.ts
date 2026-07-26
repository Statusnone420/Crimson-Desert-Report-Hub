import type { AdminClusterRow } from "@/lib/adminClusters";
import type { createServiceClient } from "@/lib/supabase";

export type FlaggedReport = {
  id: string;
  created_at: string;
  patch_version: string;
  platform: string;
  category: string;
  severity: string;
  frequency: string;
  issue_title: string;
  description: string;
  repro_steps: string | null;
  hardware_specs: string | null;
  evidence_url: string | null;
  cluster_id: string | null;
};

export type ReportReviewQueue = {
  /** Oldest first, capped at the 50-row review window. */
  flaggedReports: FlaggedReport[];
  approvedCount: number;
  pendingCount: number;
  spamCount: number;
};

export const FLAGGED_WINDOW = 50;

export type ExceptionSplit = {
  /** Everything the ledger shows: unsure claim matches plus your own locks. */
  exceptionRows: AdminClusterRow[];
  /** Engine-owned unsure matches — the only clusters that count as required work. */
  unsureClaimRows: AdminClusterRow[];
  forcedRows: AdminClusterRow[];
  autoRows: AdminClusterRow[];
};

/**
 * Split the cluster ledger into the exception views the console renders.
 * Locked rows are excluded from required work: a maintainer lock is a decision
 * already made. Every input row must come from the complete paginated read —
 * a truncated read here becomes a false green zero on Needs you.
 */
export function splitClusterExceptions(clusters: AdminClusterRow[]): ExceptionSplit {
  const exceptionRows = clusters.filter(
    (cluster) => String(cluster.lifecycle_reason ?? "").startsWith("Needs review:") || cluster.admin_override,
  );
  return {
    exceptionRows,
    unsureClaimRows: exceptionRows.filter((cluster) => !cluster.admin_override),
    forcedRows: clusters.filter((cluster) => cluster.admin_visibility_override),
    autoRows: clusters.filter((cluster) => !cluster.admin_visibility_override),
  };
}

/** Required work: flagged reports awaiting a call plus engine-owned unsure matches. */
export function countNeedsYou(pendingCount: number, unsureClaimRows: AdminClusterRow[]): number {
  return pendingCount + unsureClaimRows.length;
}

function throwOnFailure(
  label: string,
  result: { error: { message: string } | null; count?: number | null },
): void {
  if (result.error) throw new Error(`${label} read failed: ${result.error.message}`);
}

function exactCount(label: string, result: { error: { message: string } | null; count: number | null }): number {
  throwOnFailure(label, result);
  // A count read that "succeeds" without a number would render a fabricated
  // zero; the green all-clear may only ever come from a known count.
  if (result.count === null) throw new Error(`${label} read returned no count`);
  return result.count;
}

/**
 * The four reads behind the Report Review status band. Any real failure throws
 * into the admin error boundary — this page never renders a fabricated zero,
 * an invented empty queue, or a green "All clear" it cannot prove.
 */
export async function readReportReviewQueue(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ReportReviewQueue> {
  const countBy = (status: string) =>
    supabase.from("bug_reports").select("id", { count: "exact", head: true }).eq("moderation_status", status);

  const [flagged, approved, pending, spam] = await Promise.all([
    supabase
      .from("bug_reports")
      .select("*")
      .eq("moderation_status", "pending")
      .order("created_at", { ascending: true })
      .limit(FLAGGED_WINDOW),
    countBy("approved"),
    countBy("pending"),
    countBy("spam"),
  ]);

  throwOnFailure("flagged reports", flagged);
  // Symmetry with exactCount: a successful read that returned no array is not
  // proof of an empty queue, and would render a green "All clear".
  if (flagged.data === null) throw new Error("flagged reports read returned no rows");
  return {
    flaggedReports: flagged.data as FlaggedReport[],
    approvedCount: exactCount("approved count", approved),
    pendingCount: exactCount("pending count", pending),
    spamCount: exactCount("spam count", spam),
  };
}
