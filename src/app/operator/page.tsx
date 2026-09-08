import AdminPage from "@/app/admin/page";
import ScannerPage from "@/app/scanner/page";
import VideoReviewPage from "@/app/admin/videos/page";
import CompilePage from "@/app/admin/compile/page";
import {
  WorkspaceOverview,
  type WorkspaceDecisionRow,
} from "@/components/operator/WorkspaceOverview";
import { operatorView, workspaceHref } from "@/lib/operatorWorkspace";
import { readReportReviewQueue } from "@/lib/reportReview";
import { readClaimReviewQueue } from "@/lib/claimReview";
import { readVideoReviewQueue } from "@/lib/videoReviewStore";
import { createServiceClient } from "@/lib/supabase";
import { getScannerAttention } from "@/lib/scannerAttention";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { requireAdmin } from "@/lib/adminGuard";
import { collectionHealth } from "@/lib/collectionHealth";
import { platformContextConfigured, steamPulseEnabled } from "@/lib/env";
import { safeRunSummary } from "@/lib/operatorOverview";
import { getAutomationAdminData, getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";
import { getScannerAiHealth } from "@/lib/automation/health.server";
import { SCANNER_READ_REGISTERS } from "@/lib/scannerRegisters";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function OperatorPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; item?: string; run?: string }>;
} = {}) {
  const rawParams = await searchParams;
  const params = {
    view: typeof rawParams?.view === "string" ? rawParams.view : undefined,
    item: typeof rawParams?.item === "string" ? rawParams.item : undefined,
    run: typeof rawParams?.run === "string" ? rawParams.run : undefined,
  };
  const view = operatorView(params?.view);
  await requireAdmin(
    workspaceHref(view, {
      ...(params.item ? { item: params.item } : {}),
      ...(params.run ? { run: params.run } : {}),
    }),
  );
  if (view === "reports" || view === "claims" || view === "settings")
    return <AdminPage searchParams={Promise.resolve({ ...params, view })} />;
  if (view === "scanner") return <ScannerPage />;
  if (view === "videos")
    return (
      <VideoReviewPage searchParams={Promise.resolve({ item: params?.item })} />
    );
  if (view === "dossiers")
    return <CompilePage searchParams={Promise.resolve({ run: params?.run })} />;
  const client = createServiceClient();
  const [reportsRead, claimsRead, videosRead] = await Promise.allSettled([
    readReportReviewQueue(client),
    readClaimReviewQueue(client),
    readVideoReviewQueue(client),
  ]);
  const reports = reportsRead.status === "fulfilled" ? reportsRead.value : null;
  const claims =
    claimsRead.status === "fulfilled" &&
    claimsRead.value.availability.status === "available"
      ? claimsRead.value
      : null;
  const videos =
    videosRead.status === "fulfilled" && videosRead.value.status === "ok"
      ? videosRead.value
      : null;
  const videoTasks =
    videos?.candidates.filter(
      (row) => row.state === "pending" || row.state === "draft_ready",
    ) ?? [];
  const decisions: WorkspaceDecisionRow[] = [
    ...(reports?.flaggedReports ?? []).map((row) => ({
      id: row.id,
      item: row.id,
      view: "reports" as const,
      title: row.issue_title,
      detail: "Player report · approve, reject, or mark as spam",
    })),
    ...(claims?.pending ?? []).map((row) => ({
      id: row.id,
      item: row.id,
      view: "claims" as const,
      title: row.clusterTitle,
      detail: `Patch ${row.patchVersion} · compare the official claim with this issue`,
    })),
    ...videoTasks.map((row) => ({
      id: row.id,
      item: row.id,
      view: "videos" as const,
      title: row.title,
      detail:
        row.state === "draft_ready"
          ? "Private video draft · review the output"
          : "Video inbox · review the candidate",
    })),
  ];
  const [scannerResult, radarResult, adminResult] = await Promise.allSettled([
    getPublicScannerData(),
    getPatchRadarData(),
    getAutomationAdminData(),
  ]);

  // Public scanner and radar readers have their own conservative fallbacks.
  // The admin record does not: a failure remains explicit rather than becoming
  // an empty run strip.
  const scanner =
    scannerResult.status === "fulfilled" ? scannerResult.value : null;
  const radar = radarResult.status === "fulfilled" ? radarResult.value : null;
  const admin = adminResult.status === "fulfilled" ? adminResult.value : null;
  const now = new Date();
  const collection = collectionHealth({
    steamPulse: scanner?.steamPulse ?? [],
    platformContext: scanner?.platformContext ?? null,
    pulseReadFailures: scanner?.pulseReadFailures ?? ["steam", "platform"],
    steamPulseEnabled: steamPulseEnabled(),
    platformContextConfigured: platformContextConfigured(),
    scheduledCadenceMinutes: radar?.health.cadenceMinutes ?? 60,
    now,
  });

  const runs = admin ? admin.runs.map(safeRunSummary) : [];
  const aiHealth = await getScannerAiHealth(admin?.control);

  const attention = getScannerAttention({
    aiHealth,
    llmPaused: scanner?.llmPaused ?? null,
    failedRuns: radar?.connected ? radar.health.runs7d.failed : null,
    radarAvailable: Boolean(radar?.connected),
    scannerReadFailures: scanner?.readFailures ?? SCANNER_READ_REGISTERS,
    collection,
  });
  return (
    <OperatorShell active="overview">
      <WorkspaceOverview
        decisions={decisions}
        availability={{
          reports: {
            available: reports !== null,
            total: reports?.pendingCount ?? null,
          },
          claims: {
            available: claims !== null,
            total: claims?.pendingCount ?? null,
          },
          videos: {
            available: videos !== null,
            total: videos ? videoTasks.length : null,
          },
          dossiers: { available: true, total: 0 },
        }}
        health={
          <div>
            <p>
              {attention.count === null
                ? "Some health records could not be read."
                : attention.count === 0
                  ? "No recorded health checks need action."
                  : `${attention.count} checks need attention`}
            </p>
            <div>
              {attention.items.map((item) => (
                <article key={item.id} className="workspace-health-item">
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
              <p className="workspace-note">
                Scanner health is separate from decisions waiting for you.
                Collection totals are available inside Scanner.
              </p>
            </div>
          </div>
        }
        recentActivity={runs.slice(0, 5).map((run, index) => ({
          id: `${run.startedAt}-${index}`,
          title:
            run.status === "success"
              ? "Scan completed"
              : run.status === "partial"
                ? "Scan completed with limits"
                : `Scan ${run.status}`,
          detail: run.skipSummary,
          occurredAt: run.finishedAt ?? run.startedAt,
        }))}
        recentActivityAvailable={admin !== null}
      />
    </OperatorShell>
  );
}
