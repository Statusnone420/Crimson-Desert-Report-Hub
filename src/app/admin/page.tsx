import { OperatorShell } from "@/components/dispatch/Chrome";
import { ReportWorkspace } from "@/components/operator/ReportWorkspace";
import { ClaimWorkspace } from "@/components/operator/ClaimWorkspace";
import { IssueTools } from "@/components/operator/IssueTools";
import { requireAdmin } from "@/lib/adminGuard";
import { readAdminClusters } from "@/lib/adminClusters";
import { readClaimReviewQueue } from "@/lib/claimReview";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { readReportReviewQueue } from "@/lib/reportReview";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function AdminPage({
  searchParams,
}: { searchParams?: Promise<{ view?: string; item?: string }> } = {}) {
  await requireAdmin("/admin");
  const params = await searchParams;
  const client = createServiceClient();
  const clusters = await readAdminClusters(client);
  const disabled = isVercelPreview();
  if (params?.view === "claims")
    return (
      <OperatorShell active="claims">
        <ClaimWorkspace
          queue={await readClaimReviewQueue(client)}
          clusters={clusters}
          disabled={disabled}
          initialId={params.item}
        />
      </OperatorShell>
    );
  if (params?.view === "settings")
    return (
      <OperatorShell active="settings">
        <fieldset disabled={disabled} className="workspace-fieldset">
          <IssueTools
            clusters={clusters}
            currentPatch={await getCurrentPatchMetadata(client)}
          />
        </fieldset>
      </OperatorShell>
    );
  return (
    <OperatorShell active="review">
      <ReportWorkspace
        queue={await readReportReviewQueue(client)}
        clusters={clusters}
        disabled={disabled}
        initialId={params?.item}
      />
    </OperatorShell>
  );
}
