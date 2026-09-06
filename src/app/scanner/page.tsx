import type { ResolvingMetadata } from "next";
import ObservatoryPage from "@/app/observatory/page";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { isAdmin } from "@/lib/adminGuard";
import { applyLlmCircuitToStatuses, integrationStatuses } from "@/lib/env";
import { getPatchRadarData } from "@/lib/radar.server";
import { getAutomationAdminData, getPublicScannerData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

export async function generateMetadata(_props: object, parent: ResolvingMetadata) {
  const metadata = await routeMetadata(
    "The Observatory",
    "/observatory",
    "Crimson Desert review trends, Twitch audience activity and source radar in the Observatory.",
    parent,
  );
  return { ...metadata, robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

// One route, two audiences. isAdmin() is a non-throwing boolean check (unlike
// requireAdmin(), which redirects), so anonymous visitors render the public
// transparency view instead of being bounced to the login page.
export default async function ScannerPage() {
  const admin = await isAdmin();
  if (!admin) return <ObservatoryPage />;
  const [scoreboard, radar] = await Promise.all([getPublicScannerData(), getPatchRadarData()]);
  const integrations = applyLlmCircuitToStatuses(integrationStatuses(), scoreboard.llmPaused);

  const adminData = await getAutomationAdminData();
  const nowIso = new Date().toISOString();
  return (
    <OperatorShell active="scanner">
      <div className="dispatch-container">
        <AdminScannerView
          runs={adminData.runs}
          signals={adminData.signals}
          rejectedCandidates={adminData.rejectedCandidates}
          observations={adminData.observations}
          observationPatch={adminData.observationPatch}
          observationModerationAvailable={adminData.observationModerationAvailable}
          feedbackRules={adminData.feedbackRules}
          feedbackLearningAvailable={adminData.feedbackLearningAvailable}
          control={adminData.control}
          activeRun={adminData.activeRun}
          latestRealRun={adminData.latestRealRun}
          latestFind={adminData.latestFind}
          scoreboard={scoreboard}
          radar={radar}
          integrations={integrations}
          nowIso={nowIso}
        />
      </div>
    </OperatorShell>
  );
}
