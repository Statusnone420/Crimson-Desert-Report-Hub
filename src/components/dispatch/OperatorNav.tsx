"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { signOutAdmin, signOutEverywhere } from "@/app/admin/actions";
import { workspaceHref, type OperatorView } from "@/lib/operatorWorkspace";
import { WorkspaceIcon } from "@/components/operator/WorkspaceIcon";
import type { OperatorNavKey } from "@/components/dispatch/Chrome";

const OPERATOR_PAGES: Array<{ key: OperatorNavKey; view: OperatorView; label: string }> = [
  { key: "overview", view: "overview", label: "Overview" },
  { key: "review", view: "reports", label: "Reports" },
  { key: "problem-reports", view: "problem-reports", label: "Reports inbox" },
  { key: "claims", view: "claims", label: "Claim review" },
  { key: "scanner", view: "scanner", label: "Scanner" },
  { key: "ai", view: "ai", label: "AI settings" },
  { key: "videos", view: "videos", label: "Videos" },
  { key: "compile", view: "dossiers", label: "Dossiers" },
  { key: "settings", view: "settings", label: "Settings & tools" },
];

// Views no longer in regular use stay reachable by link; the sidebar lists one only while it is open.
const RETIRED_FROM_NAV = new Set<OperatorNavKey>(["review", "videos", "compile"]);

/**
 * Operator navigation split into two registers (Phase 4): page destinations on
 * the left, utilities on the right. Export CSV is a bulk download of the
 * complete private report table, so it is no longer dressed as a nav tab and
 * opens a confirm step that names its payload before the browser fetches
 * anything. Sign out stays reachable on every operator page.
 */
export function OperatorNav({ active, showAiSettings = false }: { active?: OperatorNavKey; showAiSettings?: boolean }) {
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [confirmingSignOutAll, setConfirmingSignOutAll] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const signOutAllTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // Closing unmounts whatever was focused inside the strip; hand focus back to
  // the trigger so a keyboard operator does not restart from the document top.
  function closeExportConfirm() {
    setConfirmingExport(false);
    exportTriggerRef.current?.focus();
  }

  function closeSignOutAllConfirm() {
    setConfirmingSignOutAll(false);
    signOutAllTriggerRef.current?.focus();
  }

  // The strip is a sibling of the nav, so an Escape pressed while focus is
  // still on the trigger never reaches the strip's own handler. Both elements
  // share this handler so Escape closes from either side of that boundary.
  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirmingExport) closeExportConfirm();
    else if (event.key === "Escape" && confirmingSignOutAll) closeSignOutAllConfirm();
    else if (event.key === "Escape" && mobileMenuOpen) {
      setMobileMenuOpen(false);
      menuTriggerRef.current?.focus();
      event.stopPropagation();
    }
  }

  return (
    <>
      {active === "problem-reports" && <button ref={menuTriggerRef} type="button" className="workspace-menu-toggle" aria-expanded={mobileMenuOpen} aria-controls="operator-navigation" onClick={() => setMobileMenuOpen((value) => !value)} onKeyDown={closeOnEscape}>Workspace menu<span aria-hidden="true" /></button>}
      <nav id="operator-navigation" className="workspace-nav" aria-label="Operator" data-collapsible={active === "problem-reports" ? "true" : undefined} data-mobile-open={mobileMenuOpen} onKeyDown={closeOnEscape}>
        <div className="workspace-nav-pages">
          {OPERATOR_PAGES.filter((item) => (item.key !== "ai" || showAiSettings) && (!RETIRED_FROM_NAV.has(item.key) || item.key === active)).map((item) => (
            <Link
              key={item.key}
              href={workspaceHref(item.view)}
              className="workspace-nav-link"
              aria-current={active === item.key ? "page" : undefined}
              onClick={active === "problem-reports" ? () => setMobileMenuOpen(false) : undefined}
            >
              <WorkspaceIcon name={item.view}/><span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="workspace-utilities" role="group" aria-label="Utilities">
          <button
            ref={exportTriggerRef}
            type="button"
            className="workspace-nav-link"
            aria-expanded={confirmingExport}
            aria-controls="export-confirm"
            onClick={() => {
              if (confirmingExport) return closeExportConfirm();
              setConfirmingSignOutAll(false);
              setConfirmingExport(true);
            }}
            onKeyDown={closeOnEscape}
          >
            <WorkspaceIcon name="export"/><span>Export CSV…</span><span className="sr-only"> — confirms the private 22-field report export</span>
          </button>
          <form action={signOutAdmin} style={{ display: "contents" }}>
            <button type="submit" className="workspace-nav-link">
              <WorkspaceIcon name="logout"/><span>Sign out</span>
            </button>
          </form>
          <button
            ref={signOutAllTriggerRef}
            type="button"
            className="workspace-nav-link"
            aria-expanded={confirmingSignOutAll}
            aria-controls="sign-out-all-confirm"
            onClick={() => {
              if (confirmingSignOutAll) return closeSignOutAllConfirm();
              setConfirmingExport(false);
              setConfirmingSignOutAll(true);
            }}
            onKeyDown={closeOnEscape}
          >
            <WorkspaceIcon name="logout"/><span>Sign out everywhere…</span>
          </button>
        </div>
      </nav>
      {confirmingExport ? (
        <div
          id="export-confirm"
          className="workspace-export-confirm"
          role="group"
          aria-labelledby="export-confirm-title"
          aria-describedby="export-confirm-detail"
          onKeyDown={closeOnEscape}
        >
          <p>
            <b id="export-confirm-title">Export all report-review rows?</b>{" "}
            <span id="export-confirm-detail">
              Includes the fixed 22-field review export: private descriptions, repro steps, hardware specs, PERS
              IDs, evidence URLs, and every moderation state. Submission and deduplication hashes are excluded.
            </span>
          </p>
          <a href="/api/admin/export" className="workspace-button" onClick={closeExportConfirm}>
            Download CSV
          </a>
          <button type="button" className="workspace-button" onClick={closeExportConfirm}>
            Cancel
          </button>
        </div>
      ) : null}
      {confirmingSignOutAll ? (
        <div
          id="sign-out-all-confirm"
          className="workspace-export-confirm"
          role="group"
          aria-labelledby="sign-out-all-title"
          aria-describedby="sign-out-all-detail"
          onKeyDown={closeOnEscape}
        >
          <p>
            <b id="sign-out-all-title">Sign out everywhere?</b>{" "}
            <span id="sign-out-all-detail">
              Ends every admin login at once: this browser, any other browser, and any agent signed in for you.
              Everyone signs in again with the password.
            </span>
          </p>
          <form action={signOutEverywhere} style={{ display: "contents" }}>
            <button type="submit" className="workspace-button">Sign out everywhere</button>
          </form>
          <button type="button" className="workspace-button" onClick={closeSignOutAllConfirm}>
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}
