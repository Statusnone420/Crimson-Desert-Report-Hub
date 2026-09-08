"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { signOutAdmin } from "@/app/admin/actions";
import { workspaceHref, type OperatorView } from "@/lib/operatorWorkspace";
import { WorkspaceIcon } from "@/components/operator/WorkspaceIcon";
import type { OperatorNavKey } from "@/components/dispatch/Chrome";

const OPERATOR_PAGES: Array<{ key: OperatorNavKey; view: OperatorView; label: string }> = [
  { key: "overview", view: "overview", label: "Overview" },
  { key: "review", view: "reports", label: "Reports" },
  { key: "claims", view: "claims", label: "Claim review" },
  { key: "scanner", view: "scanner", label: "Scanner" },
  { key: "videos", view: "videos", label: "Videos" },
  { key: "compile", view: "dossiers", label: "Dossiers" },
  { key: "settings", view: "settings", label: "Settings & tools" },
];

/**
 * Operator navigation split into two registers (Phase 4): page destinations on
 * the left, utilities on the right. Export CSV is a bulk download of the
 * complete private report table, so it is no longer dressed as a nav tab and
 * opens a confirm step that names its payload before the browser fetches
 * anything. Sign out stays reachable on every operator page.
 */
export function OperatorNav({ active }: { active?: OperatorNavKey }) {
  const [confirmingExport, setConfirmingExport] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  // Closing unmounts whatever was focused inside the strip; hand focus back to
  // the trigger so a keyboard operator does not restart from the document top.
  function closeExportConfirm() {
    setConfirmingExport(false);
    exportTriggerRef.current?.focus();
  }

  // The strip is a sibling of the nav, so an Escape pressed while focus is
  // still on the trigger never reaches the strip's own handler. Both elements
  // share this handler so Escape closes from either side of that boundary.
  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirmingExport) closeExportConfirm();
  }

  return (
    <>
      <nav className="workspace-nav" aria-label="Operator">
        <div className="workspace-nav-pages">
          {OPERATOR_PAGES.map((item) => (
            <Link
              key={item.key}
              href={workspaceHref(item.view)}
              className="workspace-nav-link"
              aria-current={active === item.key ? "page" : undefined}
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
            onClick={() => (confirmingExport ? closeExportConfirm() : setConfirmingExport(true))}
            onKeyDown={closeOnEscape}
          >
            <WorkspaceIcon name="export"/><span>Export CSV…</span><span className="sr-only"> — confirms the private 22-field report export</span>
          </button>
          <form action={signOutAdmin} style={{ display: "contents" }}>
            <button type="submit" className="workspace-nav-link">
              <WorkspaceIcon name="logout"/><span>Sign out</span>
            </button>
          </form>
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
    </>
  );
}
