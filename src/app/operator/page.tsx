import { OperatorOverview } from "@/components/newspaper/OperatorOverview";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { requireAdmin } from "@/lib/adminGuard";
import { collectionHealth } from "@/lib/collectionHealth";
import { platformContextConfigured, steamPulseEnabled } from "@/lib/env";
import { safeRunSummary } from "@/lib/operatorOverview";
import { getAutomationAdminData, getPublicScannerData } from "@/lib/queries";
import { getPatchRadarData } from "@/lib/radar.server";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function OperatorPage() {
  await requireAdmin("/operator");

  const [scannerResult, radarResult, adminResult] = await Promise.allSettled([
    getPublicScannerData(),
    getPatchRadarData(),
    getAutomationAdminData(),
  ]);

  // Public scanner and radar readers have their own conservative fallbacks.
  // The admin record does not: a failure remains explicit rather than becoming
  // an empty run strip.
  const scanner = scannerResult.status === "fulfilled" ? scannerResult.value : null;
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

  const scannerReadAvailable = Boolean(radar?.connected && scanner?.scannerConnected);
  const scannerReadFailures = scanner?.readFailures ?? ["week", "heartbeat", "awaiting", "published"];
  const runs = admin ? admin.runs.map(safeRunSummary) : [];

  return (
    <OperatorShell active="overview">
      <OperatorOverview
        data={{
          operatorReadAvailable: admin !== null,
          scannerReadAvailable,
          scannerReadFailures,
          scannerFailedRuns: radar?.connected ? radar.health.runs7d.failed : null,
          collection,
          runs,
        }}
      />
    </OperatorShell>
  );
}
