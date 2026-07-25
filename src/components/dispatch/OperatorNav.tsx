"use client";

import Link from "next/link";
import { useState } from "react";
import { signOutAdmin } from "@/app/admin/actions";
import type { OperatorNavKey } from "@/components/dispatch/Chrome";

const OPERATOR_PAGES: Array<{ key: OperatorNavKey; href: string; label: string }> = [
  { key: "review", href: "/admin", label: "REPORT REVIEW" },
  { key: "scanner", href: "/scanner", label: "SCANNER MONITOR" },
  { key: "compile", href: "/admin/compile", label: "DOSSIERS" },
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
        <div className="operator-utils">
          <span className="operator-utils__label" aria-hidden="true">
            Utilities
          </span>
          <button
            type="button"
            className="operator-utils__btn"
            aria-expanded={confirmingExport}
            onClick={() => setConfirmingExport((open) => !open)}
          >
            ↓ Export CSV…<span className="sr-only"> — downloads the full private report table</span>
          </button>
          <form action={signOutAdmin} style={{ display: "contents" }}>
            <button type="submit" className="operator-utils__btn operator-utils__btn--signout">
              Sign out
            </button>
          </form>
        </div>
      </nav>
      {confirmingExport ? (
        <div className="export-confirm" role="group" aria-label="Confirm export">
          <p>
            <b>Export the complete private report table?</b> Descriptions, repro steps, hardware specs, and IDs
            — everything reports contain, including what never becomes public.
          </p>
          <a href="/api/admin/export" className="tap-btn" onClick={() => setConfirmingExport(false)}>
            Download CSV
          </a>
          <button type="button" className="export-confirm__cancel" onClick={() => setConfirmingExport(false)}>
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}
