import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { PublicScannerView } from "@/components/scanner/PublicScannerView";
import { isAdmin } from "@/lib/adminGuard";
import { applyLlmCircuitToStatuses, features, integrationStatuses } from "@/lib/env";
import { getAutomationAdminData, getIssuesData, getPublicScannerData } from "@/lib/queries";

export const dynamic = "force-dynamic";

// One route, two audiences. isAdmin() is a non-throwing boolean check (unlike
// requireAdmin(), which redirects), so anonymous visitors render the public
// transparency view instead of being bounced to the login page.
export default async function ScannerPage() {
  const admin = await isAdmin();
  const scoreboard = await getPublicScannerData();
  const integrations = applyLlmCircuitToStatuses(integrationStatuses(), scoreboard.llmPaused);

  if (!admin) {
    const { clusters, currentPatch } = await getIssuesData();
    const leadQuestions = clusters
      .filter((cluster) => cluster.candidateSignalCount > 0)
      .sort((a, b) => b.candidateSignalCount - a.candidateSignalCount);
    return (
      <PublicScannerView
        data={scoreboard}
        integrations={integrations}
        patchVersion={currentPatch.version}
        leadQuestions={leadQuestions}
      />
    );
  }

  const adminData = await getAutomationAdminData();
  return (
    <AdminScannerView
      runs={adminData.runs}
      signals={adminData.signals}
      rejectedCandidates={adminData.rejectedCandidates}
      control={adminData.control}
      activeRun={adminData.activeRun}
      latestRealRun={adminData.latestRealRun}
      latestFind={adminData.latestFind}
      scoreboard={scoreboard}
      features={features()}
      integrations={integrations}
    />
  );
}
