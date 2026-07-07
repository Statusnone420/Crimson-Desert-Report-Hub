import { AdminScannerView } from "@/components/scanner/AdminScannerView";
import { PublicScannerView } from "@/components/scanner/PublicScannerView";
import { isAdmin } from "@/lib/adminGuard";
import { features, integrationStatuses } from "@/lib/env";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { getAutomationAdminData, getPublicScannerData } from "@/lib/queries";

export const dynamic = "force-dynamic";

// One route, two audiences. isAdmin() is a non-throwing boolean check (unlike
// requireAdmin(), which redirects), so anonymous visitors render the public
// transparency view instead of being bounced to the login page.
export default async function ScannerPage() {
  const admin = await isAdmin();
  const scoreboard = await getPublicScannerData();

  if (!admin) {
    const patch = await getCurrentPatchMetadata();
    return (
      <PublicScannerView data={scoreboard} integrations={integrationStatuses()} patchVersion={patch.version} />
    );
  }

  const adminData = await getAutomationAdminData();
  return (
    <AdminScannerView
      runs={adminData.runs}
      rejectedCandidates={adminData.rejectedCandidates}
      control={adminData.control}
      activeRun={adminData.activeRun}
      latestRealRun={adminData.latestRealRun}
      latestFind={adminData.latestFind}
      scoreboard={scoreboard}
      features={features()}
      integrations={integrationStatuses()}
    />
  );
}
