import { ReportForm } from "@/app/report/ReportForm";
import { getCurrentPatchMetadata, patchVersionOptions } from "@/lib/officialPatch.server";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const currentPatch = await getCurrentPatchMetadata();

  return <ReportForm currentPatch={currentPatch} patchVersions={patchVersionOptions(currentPatch.version)} />;
}
