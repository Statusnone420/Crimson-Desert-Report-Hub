"use client";

import Link from "next/link";
import { OperatorNav } from "@/components/dispatch/OperatorNav";
import { ThemeToggle } from "@/components/newspaper/NewspaperHeader";

export function WorkspaceError({ reset }: { reset: () => void }) {
  return <div className="operator-newspaper operator-workspace">
    <aside className="workspace-sidebar">
      <Link className="workspace-identity" href="/operator"><strong>Crimson Desert<br/><em>Report Hub</em></strong></Link>
      <OperatorNav/>
    </aside>
    <div className="workspace-main-column">
      <header className="workspace-topbar"><strong>Workspace unavailable</strong><ThemeToggle/></header>
      <main id="main-content" className="workspace-main">
        <div className="workspace-page"><header className="workspace-heading"><h1>This view could not finish loading.</h1></header>
          <p role="alert">The records are unavailable. Check the current record before repeating a save.</p>
          <div className="workspace-actions"><button type="button" className="workspace-button workspace-button--primary" onClick={reset}>Reload this view</button><Link className="workspace-button" href="/operator">Back to overview</Link></div>
        </div>
      </main>
    </div>
  </div>;
}
