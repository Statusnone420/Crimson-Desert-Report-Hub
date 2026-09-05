import Link from "next/link";
import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import { ReportForm } from "@/app/report/ReportForm";
import { PublicShell } from "@/components/dispatch/Chrome";
import { getReportPatchContext } from "@/lib/officialPatch.server";
import { routeMetadata } from "@/lib/site";

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "File a Report",
    "/report",
    "Hit something broken in Crimson Desert? Put it on the record — an anonymous report with the patch, platform, steps, and any evidence you've got.",
    parent,
  );
}

export default async function ReportPage() {
  await connection();
  const { currentPatch, patchVersions } = await getReportPatchContext();

  return (
    <PublicShell active="report">
      <div className="dispatch-container filing-page">
        <section className="filing-heading" aria-labelledby="report-page-title">
          <Link className="back-link" href="/issues">← Back to the player record</Link>
          <p className="kicker">The player record</p>
          <h1 id="report-page-title">Tell us what happened.</h1>
          <p>A useful report starts with your game, your patch, and what went wrong.</p>
          <div className="filing-intro">
            <span>No account. No email.</span>
            <Link href="/issues#board">Find an existing issue →</Link>
          </div>
        </section>
        <ReportForm currentPatch={currentPatch} patchVersions={patchVersions} />
        <div className="filing-footer">
          <Link href="/issues">← Player reports</Link>
          <a href="#main-content">Back to top ↑</a>
        </div>
      </div>
    </PublicShell>
  );
}
