import Link from "next/link";
import type { ResolvingMetadata } from "next";
import { connection } from "next/server";
import { ReportForm, type ReportIssueContext } from "@/app/report/ReportForm";
import { PublicShell } from "@/components/dispatch/Chrome";
import { CATEGORIES, type Category } from "@/lib/constants";
import { needsFullIssueCard } from "@/lib/evidence";
import { getReportPatchContext } from "@/lib/officialPatch.server";
import { getIssuesData } from "@/lib/queries";
import { routeMetadata } from "@/lib/site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

async function getPublicIssueContext(value: string | string[] | undefined): Promise<ReportIssueContext | null> {
  if (typeof value !== "string" || !UUID.test(value)) return null;

  try {
    const { clusters, boardReadFailed = false } = await getIssuesData();
    if (boardReadFailed) return null;
    const cluster = clusters.find((candidate) => candidate.id.toLowerCase() === value.toLowerCase());
    if (!cluster || !isCategory(cluster.category)) return null;

    // Match the Issue Board's two visible lanes. A private or monitored-only
    // cluster must never disclose its title through a crafted report URL.
    const visibleOnBoard = needsFullIssueCard(cluster) || cluster.candidateSignalCount > 0;
    if (!visibleOnBoard) return null;

    return { id: cluster.id, title: cluster.title, category: cluster.category };
  } catch {
    // Context is optional. An unreadable board leaves the normal report flow
    // intact and does not turn an outage into a title-disclosure fallback.
    return null;
  }
}

export function generateMetadata(_props: object, parent: ResolvingMetadata) {
  return routeMetadata(
    "File a Report",
    "/report",
    "Hit something broken in Crimson Desert? Put it on the record — an anonymous report with the patch, platform, steps, and any evidence you've got.",
    parent,
  );
}

export default async function ReportPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ issue?: string | string[] }>;
} = {}) {
  await connection();
  const query = await searchParams;
  const [{ currentPatch, patchVersions }, issueContext] = await Promise.all([
    getReportPatchContext(),
    getPublicIssueContext(query.issue),
  ]);

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
        <ReportForm
          key={issueContext?.id ?? "new-report"}
          currentPatch={currentPatch}
          patchVersions={patchVersions}
          issueContext={issueContext}
        />
        <div className="filing-footer">
          <Link href="/issues">← Player reports</Link>
          <a href="#main-content">Back to top ↑</a>
        </div>
      </div>
    </PublicShell>
  );
}
