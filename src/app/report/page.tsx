import { ReportForm } from "@/app/report/ReportForm";
import { getReportPatchContext } from "@/lib/officialPatch.server";

export const revalidate = 300;

export default async function ReportPage() {
  const { currentPatch, patchVersions } = await getReportPatchContext();

  return <ReportForm currentPatch={currentPatch} patchVersions={patchVersions} />;
}
