import { ReportForm } from "@/app/report/ReportForm";
import { getCurrentPatchMetadata, patchVersionOptions } from "@/lib/officialPatch.server";

export const revalidate = 300;

export default async function ReportPage() {
  const currentPatch = await getCurrentPatchMetadata();

  return <ReportForm currentPatch={currentPatch} patchVersions={patchVersionOptions(currentPatch.version)} />;
}
