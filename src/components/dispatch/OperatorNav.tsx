"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { signOutAdmin } from "@/app/admin/actions";
import type { OperatorNavKey } from "@/components/dispatch/Chrome";

const OPERATOR_PAGES: Array<{ key: OperatorNavKey; href: string; label: string }> = [
  { key: "overview", href: "/operator", label: "Overview" },
  { key: "review", href: "/admin", label: "Report review" },
  { key: "scanner", href: "/scanner", label: "Scanner monitor" },
  { key: "compile", href: "/admin/compile", label: "Dossiers" },
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
      <nav className="dispatch-nav dispatch-nav--operator" aria-label="Operator">
        <div className="operator-nav__pages">
          {OPERATOR_PAGES.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="dispatch-nav__link"
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="operator-utils" role="group" aria-label="Utilities">
          <span className="operator-utils__label" aria-hidden="true">
            Utilities
          </span>
          <button
            ref={exportTriggerRef}
            type="button"
            className="operator-utils__btn"
            aria-expanded={confirmingExport}
            aria-controls="export-confirm"
            onClick={() => (confirmingExport ? closeExportConfirm() : setConfirmingExport(true))}
            onKeyDown={closeOnEscape}
          >
            ↓ Export CSV…<span className="sr-only"> — confirms the private 22-field report export</span>
          </button>
          <form action={signOutAdmin} style={{ display: "contents" }}>
            <button type="submit" className="operator-utils__btn operator-utils__btn--signout">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      {confirmingExport ? (
        <div
          id="export-confirm"
          className="export-confirm"
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
          <a href="/api/admin/export" className="tap-btn" onClick={closeExportConfirm}>
            Download CSV
          </a>
          <button type="button" className="export-confirm__cancel" onClick={closeExportConfirm}>
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}
