import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DossierRun } from "@/components/operator/DossierWorkspace";

type DossierRunRow = { id: string; created_at: string; provider: string; markdown?: string };

export type DossierRunWorkspaceData = {
  runs: DossierRun[];
  selected: (DossierRun & { markdown: string }) | null;
  requestedRunMissing: boolean;
};

export async function readDossierRunWorkspace(
  supabase: SupabaseClient,
  requestedRunId?: string,
): Promise<DossierRunWorkspaceData> {
  const historyResult = await supabase
    .from("dossier_runs")
    .select("id, created_at, provider")
    .order("created_at", { ascending: false })
    .limit(10);
  if (historyResult.error) throw new Error(`dossier run history read failed: ${historyResult.error.message}`);

  const runs: DossierRun[] = ((historyResult.data as DossierRunRow[] | null) ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
  }));

  if (!requestedRunId) return { runs, selected: null, requestedRunMissing: false };
  if (!z.uuid().safeParse(requestedRunId).success) {
    return { runs, selected: null, requestedRunMissing: true };
  }

  const selectedResult = await supabase
    .from("dossier_runs")
    .select("id, markdown, provider, created_at")
    .eq("id", requestedRunId)
    .limit(1);
  if (selectedResult.error) throw new Error(`dossier run read failed: ${selectedResult.error.message}`);

  const row = (selectedResult.data as DossierRunRow[] | null)?.[0];
  if (!row) return { runs, selected: null, requestedRunMissing: true };
  return {
    runs,
    selected: { id: row.id, createdAt: row.created_at, provider: row.provider, markdown: String(row.markdown ?? "") },
    requestedRunMissing: false,
  };
}
