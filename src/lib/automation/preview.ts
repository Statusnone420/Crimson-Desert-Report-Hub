import "server-only";
import { buildSearchQueries } from "@/lib/automation/search";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { isCurrentPatchVerified } from "@/lib/patchWatch";

export type AutomationSourcePreview = {
  mode: "preview";
  patchVersion: string;
  maxQueries: number;
  queriesUsed: number;
  resultsSeen: number;
  estimatedCostUsd: number;
  unavailableReason: "current_patch_unavailable" | "paid_diagnostics_disabled";
  queryPlan: string[];
  previews: [];
};

/** Read-only query plan. Diagnostics cannot spend outside the scanner ledger. */
export async function previewAutomationSearch(input: { maxQueries: number }): Promise<AutomationSourcePreview> {
  const maxQueries = Number.isFinite(input.maxQueries) ? Math.max(0, Math.min(2, Math.trunc(input.maxQueries))) : 1;
  const patch = await getCurrentPatchMetadata();
  const verified = isCurrentPatchVerified(patch);
  return { mode: "preview", patchVersion: patch.version, maxQueries, queriesUsed: 0,
    resultsSeen: 0, estimatedCostUsd: 0, previews: [], queryPlan: verified ? buildSearchQueries(maxQueries, patch.version) : [],
    unavailableReason: verified ? "paid_diagnostics_disabled" : "current_patch_unavailable" };
}
