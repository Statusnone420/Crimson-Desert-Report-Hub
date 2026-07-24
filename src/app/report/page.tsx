import type { Metadata } from "next";
import { ReportForm } from "@/app/report/ReportForm";
import { PublicShell } from "@/components/dispatch/Chrome";
import { getReportPatchContext } from "@/lib/officialPatch.server";

export const metadata: Metadata = {
  title: "File a Report",
  alternates: { canonical: "/report" },
};

export const revalidate = 300;

export default async function ReportPage() {
  const { currentPatch, patchVersions } = await getReportPatchContext();

  return (
    <PublicShell active="report">
      <div className="dispatch-container">
        <ReportForm currentPatch={currentPatch} patchVersions={patchVersions} />
      </div>
    </PublicShell>
  );
}
