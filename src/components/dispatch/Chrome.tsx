import Link from "next/link";
import type { ReactNode } from "react";
import { NewspaperShell } from "@/components/newspaper/NewspaperShell";
import { ThemeToggle } from "@/components/newspaper/NewspaperHeader";
import { isVercelPreview } from "@/lib/previewGuard";
import { OperatorNav } from "@/components/dispatch/OperatorNav";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import { CatchUpPublicVisit } from "@/components/catchup/CatchUpContext";
import { WORKSPACE_LABELS, type OperatorView } from "@/lib/operatorWorkspace";
import { WorkspaceIcon } from "@/components/operator/WorkspaceIcon";

export type PublicNavKey = "brief" | "news" | "watch" | "issues" | "patches" | "observatory" | "method" | "report";
export type OperatorNavKey = "overview" | "review" | "claims" | "videos" | "scanner" | "compile" | "settings";

/** Deterministic dateline: UTC so server rendering never depends on host locale. */
export function dispatchDateline(date: Date = new Date()): string {
  return date
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

export function PublicShell({ active, masthead = false, children }: {
  active?: PublicNavKey;
  masthead?: boolean;
  edition?: number | null;
  children: ReactNode;
}) {
  return <><CatchUpPublicVisit /><NewspaperShell active={active} home={masthead}>{children}</NewspaperShell></>;
}

/** One private workspace shared by canonical and legacy admin entry points. */
export async function OperatorShell({
  active,
  children,
}: {
  active?: OperatorNavKey;
  children: ReactNode;
}) {
  const patch = await getCurrentPatchMetadata();
  const family = patchFamilyKey(patch.version);
  const view: OperatorView = active === "review" ? "reports" : active === "compile" ? "dossiers" : active ?? "overview";
  return (
    <div className="operator-newspaper operator-workspace">
      <a className="workspace-skip-link" href="#main-content">Skip to workspace</a>
      <aside className="workspace-sidebar">
        <Link className="workspace-identity" href="/operator"><span><strong>Crimson Desert<br/><em>Report Hub</em></strong><small>Your admin workspace</small></span></Link>
        <OperatorNav active={active} />
        <p className="workspace-sidebar-note">Crimson Desert Report Hub<br/>Private workspace{family ? ` · v${family}` : ""}</p>
      </aside>
      <div className="workspace-main-column">
        <header className="workspace-topbar"><div className="workspace-breadcrumb"><span>Workspace</span><WorkspaceIcon name="arrow"/><strong>{WORKSPACE_LABELS[view]}</strong></div><div className="workspace-top-tools"><Link href="/">View public site</Link><ThemeToggle/></div></header>
        {isVercelPreview() && <p className="workspace-preview-notice">{process.env.CD_LOCAL_SNAPSHOT === "true" ? "Local preview · Copy of production data. Changes and scans are disabled." : "Preview edition · Changes and scans are disabled."}</p>}
        <main id="main-content" className="workspace-main">{children}</main>
        <footer className="workspace-footer">Operator surfaces are never linked publicly. Sessions expire 12 hours after sign-in.</footer>
      </div>
    </div>
  );
}
