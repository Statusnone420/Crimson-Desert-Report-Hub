import type { ResolvingMetadata } from "next";
import ObservatoryPage from "@/app/observatory/page";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { isAdmin } from "@/lib/adminGuard";
import { applyLlmCircuitToStatuses, integrationStatuses } from "@/lib/env";
import { getPatchRadarData } from "@/lib/radar.server";
import { getAutomationAdminData, getPublicScannerData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";
import { getScannerAiHealth } from "@/lib/automation/health.server";
import { getScannerExecution } from "@/lib/automation/execution.server";
import { ScannerExecutionHealth } from "@/components/scanner/ScannerExecutionHealth";
import type { ScannerExecutionRead } from "@/lib/automation/diagnostics";

function unavailableExecution(detail: string): ScannerExecutionRead {
  return {
    state: "unavailable",
    code: "status_read_unavailable",
    detail,
    started: null,
    snapshot: null,
  };
}

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

// One implementation, two audiences. isAdmin() is a non-throwing boolean check (unlike
// requireAdmin(), which redirects), so anonymous visitors render the public
// transparency view instead of being bounced to the login page.
export default async function ScannerPage({ searchParams }: { searchParams?: Promise<{ section?: string }> } = {}) {
  const admin = await isAdmin();
  if (!admin) return <ObservatoryPage />;
  const collectionExpanded = (await searchParams)?.section === "collection";
  const nowIso = new Date().toISOString();
  const [scoreboardRead, radarRead, adminRead, executionRead] = await Promise.allSettled([
    getPublicScannerData(),
    getPatchRadarData(),
    getAutomationAdminData(),
    getScannerExecution(),
  ]);
  const execution = executionRead.status === "fulfilled" && executionRead.value
    ? executionRead.value
    : unavailableExecution("The private trigger-status read did not complete for this page load.");

  if (adminRead.status !== "fulfilled") {
    return (
      <OperatorShell active="scanner">
        <div className="dispatch-container">
          <ScannerExecutionHealth execution={execution} nowIso={nowIso} />
          <section className="workspace-panel"><div className="workspace-panel-body"><h1>Scanner administration unavailable</h1><p>The Supabase admin read did not complete. Scanner policy, controls, run history, and counts are unavailable for this page load.</p></div></section>
        </div>
      </OperatorShell>
    );
  }
  if (scoreboardRead.status !== "fulfilled" || radarRead.status !== "fulfilled") {
    return (
      <OperatorShell active="scanner">
        <div className="dispatch-container">
          <ScannerExecutionHealth execution={execution} nowIso={nowIso} />
          <section className="workspace-panel"><div className="workspace-panel-body"><h1>Scanner supporting reads unavailable</h1><p>The public scanner or radar read did not complete. The control surface is hidden until this page can show its current evidence.</p></div></section>
        </div>
      </OperatorShell>
    );
  }
  const scoreboard = scoreboardRead.value;
  const radar = radarRead.value;
  const integrations = applyLlmCircuitToStatuses(integrationStatuses(), scoreboard.llmPaused);
  const adminData = adminRead.value;
  const aiHealth = await getScannerAiHealth(adminData.control);
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
          budgetCapped={adminData.budgetCapped}
          activeRun={adminData.activeRun}
          latestRealRun={adminData.latestRealRun}
          latestCompletedRun={adminData.latestCompletedRun}
          latestFind={adminData.latestFind}
          scoreboard={scoreboard}
          radar={radar}
          integrations={integrations}
          nowIso={nowIso}
          aiHealth={aiHealth}
          execution={execution}
          collectionExpanded={collectionExpanded}
        />
      </div>
    </OperatorShell>
  );
}
