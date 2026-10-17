import { OperatorShell } from "@/components/dispatch/Chrome";
import { ProblemReportsInbox } from "@/components/operator/ProblemReportsInbox";
import { requireAdmin } from "@/lib/adminGuard";
import { isVercelPreview } from "@/lib/previewGuard";
import { listProblemReports, ProblemReportsUnavailable } from "@/lib/problemReports.server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports inbox", robots: { index: false, follow: false } };

export default async function ProblemReportsPage() {
  await requireAdmin("/admin/problem-reports");
  let queue;
  try { queue = await listProblemReports(createServiceClient()); }
  catch (error) {
    return <OperatorShell active="problem-reports"><div className="workspace-page"><header className="workspace-heading"><h1>Reports inbox</h1></header><p className="workspace-error" role="status">{error instanceof ProblemReportsUnavailable && error.reason === "schema_missing" ? "The private reporting migration has not been applied. Existing admin tools remain available." : "The private reports inbox could not be read. Try refreshing this page."}</p></div></OperatorShell>;
  }
  return <OperatorShell active="problem-reports"><ProblemReportsInbox initial={queue} disabled={isVercelPreview()} /></OperatorShell>;
}
