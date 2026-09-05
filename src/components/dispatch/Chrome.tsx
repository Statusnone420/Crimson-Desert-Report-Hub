import Link from "next/link";
import type { ReactNode } from "react";
import { NewspaperShell } from "@/components/newspaper/NewspaperShell";
import { ThemeToggle } from "@/components/newspaper/NewspaperHeader";
import { isVercelPreview } from "@/lib/previewGuard";
import { OperatorNav } from "@/components/dispatch/OperatorNav";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";

export type PublicNavKey = "brief" | "news" | "watch" | "issues" | "patches" | "observatory" | "method" | "report";
export type OperatorNavKey = "overview" | "review" | "scanner" | "compile";

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
  return <NewspaperShell active={active} home={masthead}>{children}</NewspaperShell>;
}

/** Operator chrome: amber topline, console nav, session-truthful footer. */
export async function OperatorShell({
  active,
  children,
}: {
  active?: OperatorNavKey;
  children: ReactNode;
}) {
  const patch = await getCurrentPatchMetadata();
  const family = patchFamilyKey(patch.version);
  return (
    <div className="operator-newspaper">
      <div className="dispatch-topline dispatch-topline--operator" aria-hidden="true" />
      <header className="dispatch-container nameplate">
        <div className="nameplate__row">
          <div className="nameplate__meta nameplate__meta--operator">Operator console · signed in</div>
          <p className="nameplate__title">
            <Link href="/">
              Crimson Desert <em>Report Hub</em>
            </Link>
          </p>
          <div className="nameplate__meta nameplate__meta--right">{dispatchDateline()}<span className="theme"><ThemeToggle/></span></div>
        </div>
        <OperatorNav active={active} />
      </header>
      {isVercelPreview() && <p className="dispatch-container op-preview-notice">{process.env.CD_LOCAL_SNAPSHOT === "true" ? "Local preview · Copy of production data. Changes and scans are disabled." : "Preview edition · Changes and scans are disabled."}</p>}
      <main id="main-content">{children}</main>
      <footer className="dispatch-footer">
        <p className="dispatch-footer__note">
          Operator surfaces are never linked publicly. Sessions expire 12 hours after sign-in.
        </p>
        <div className="dispatch-footer__links">
          <span>{family ? `OPERATOR · v${family} CONSOLE` : "OPERATOR CONSOLE"}</span>
        </div>
      </footer>
    </div>
  );
}
