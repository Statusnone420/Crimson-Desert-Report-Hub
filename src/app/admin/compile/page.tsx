import { OperatorShell } from "@/components/dispatch/Chrome";
import { DossierWorkspace } from "@/components/operator/DossierWorkspace";
import { requireAdmin } from "@/lib/adminGuard";
import { features } from "@/lib/env";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";
import { readDossierRunWorkspace } from "@/lib/dossierRunStore";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Compile dossier",
  robots: { index: false, follow: false },
};

export default async function CompilePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await requireAdmin("/admin/compile");
  const { run } = await searchParams;
  const supabase = createServiceClient();
  const { runs, selected, requestedRunMissing } = await readDossierRunWorkspace(supabase, run);

  return (
    <OperatorShell active="compile">
      <DossierWorkspace aiAvailable={features().ai} runs={runs} selected={selected} requestedRunMissing={requestedRunMissing} writesDisabled={isVercelPreview()} />
    </OperatorShell>
  );
}
