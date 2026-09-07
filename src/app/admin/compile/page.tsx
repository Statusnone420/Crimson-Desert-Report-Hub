import { OperatorShell } from "@/components/dispatch/Chrome";
import { DossierWorkspace, type DossierRun } from "@/components/operator/DossierWorkspace";
import { requireAdmin } from "@/lib/adminGuard";
import { features } from "@/lib/env";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Compile dossier",
  robots: { index: false, follow: false },
};

type DossierRunRow = { id: string; created_at: string; provider: string; markdown?: string };

export default async function CompilePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await requireAdmin("/admin/compile");
  const { run } = await searchParams;
  const supabase = createServiceClient();
  const historyResult = await supabase
    .from("dossier_runs")
    .select("id, created_at, provider")
    .order("created_at", { ascending: false })
    .limit(10);
  if (historyResult.error) throw new Error(`dossier run history read failed: ${historyResult.error.message}`);

  let selected: (DossierRun & { markdown: string }) | null = null;
  let requestedRunMissing = false;
  if (run) {
    const selectedResult = await supabase
      .from("dossier_runs")
      .select("id, markdown, provider, created_at")
      .eq("id", run)
      .limit(1);
    if (selectedResult.error) throw new Error(`dossier run read failed: ${selectedResult.error.message}`);
    const row = (selectedResult.data as DossierRunRow[] | null)?.[0];
    if (!row) requestedRunMissing = true;
    else selected = { id: row.id, createdAt: row.created_at, provider: row.provider, markdown: String(row.markdown ?? "") };
  }

  const runs: DossierRun[] = ((historyResult.data as DossierRunRow[] | null) ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
  }));

  return (
    <OperatorShell active="compile">
      <DossierWorkspace aiAvailable={features().ai} runs={runs} selected={selected} requestedRunMissing={requestedRunMissing} writesDisabled={isVercelPreview()} />
    </OperatorShell>
  );
}
