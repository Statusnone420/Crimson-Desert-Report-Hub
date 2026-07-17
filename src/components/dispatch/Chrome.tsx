import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAdmin } from "@/app/admin/actions";
import { AdminControls } from "@/components/AdminControls";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { patchFamilyKey } from "@/lib/patchWatch";
import { SOURCE_URL } from "@/lib/site";

export type PublicNavKey = "brief" | "issues" | "observatory" | "method" | "report";
export type OperatorNavKey = "review" | "scanner" | "compile";

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

function dispatchDatelineShort(date: Date = new Date()): string {
  return date
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

const PUBLIC_NAV: Array<{
  key: PublicNavKey;
  href: string;
  full: string;
  short: string;
  className?: string;
}> = [
  { key: "brief", href: "/", full: "THE BRIEF", short: "BRIEF" },
  { key: "issues", href: "/issues", full: "ISSUE BOARD", short: "ISSUES" },
  { key: "observatory", href: "/scanner", full: "OBSERVATORY", short: "OBSERVATORY" },
  { key: "method", href: "/about", full: "METHOD", short: "METHOD", className: "dispatch-nav__link--method" },
  { key: "report", href: "/report", full: "FILE A REPORT →", short: "REPORT", className: "dispatch-nav__link--report" },
];

function PublicNav({ active }: { active?: PublicNavKey }) {
  return (
    <nav className="dispatch-nav" aria-label="Primary">
      {PUBLIC_NAV.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`dispatch-nav__link ${item.className ?? ""}`.trim()}
          aria-current={active === item.key ? "page" : undefined}
        >
          <span className="dispatch-nav__full">{item.full}</span>
          <span className="dispatch-nav__short">{item.short}</span>
        </Link>
      ))}
    </nav>
  );
}

function PublicFooter() {
  return (
    <footer className="dispatch-footer">
      <p className="dispatch-footer__note">
        Reports are evidence. Taps are signals. Scanner links are leads. Official notes are context. The tracker
        never invents counts, and quiet never means fixed. Unofficial and fan-run — not affiliated with Pearl
        Abyss. No accounts, no ads, no tracking.
      </p>
      <div className="dispatch-footer__links">
        <Link href="/about">Method</Link>
        <span aria-hidden="true">·</span>
        <Link href="/about#privacy">Privacy</Link>
        <span aria-hidden="true">·</span>
        <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
          Source
        </a>
        <span aria-hidden="true">·</span>
        <AdminControls />
      </div>
    </footer>
  );
}

/**
 * Public chrome. `masthead` renders the full homepage masthead; interior pages
 * get the compact nameplate. Edition № is real data (distinct tracked patch
 * versions) supplied by the homepage — omitted entirely when unknown.
 */
export function PublicShell({
  active,
  masthead = false,
  edition,
  children,
}: {
  active?: PublicNavKey;
  masthead?: boolean;
  edition?: number | null;
  children: ReactNode;
}) {
  const now = new Date();
  const dateline = dispatchDateline(now);
  const shortDate = dispatchDatelineShort(now);
  return (
    <>
      <div className="dispatch-topline" aria-hidden="true" />
      {masthead ? (
        <header className="dispatch-container masthead">
          <div className="masthead__meta">
            <div>
              <span className="dispatch-nav__full">INDEPENDENT PATCH INTELLIGENCE</span>
              <span className="dispatch-nav__short">PATCH INTELLIGENCE</span>
            </div>
            <div>
              <span className="dispatch-nav__full">
                {dateline}
                {typeof edition === "number" ? ` · EDITION №${edition}` : ""}
              </span>
              <span className="dispatch-nav__short">
                {shortDate}
                {typeof edition === "number" ? ` · №${edition}` : ""}
              </span>
            </div>
          </div>
          <div className="masthead__title-block">
            <h1 className="masthead__title">
              Crimson Desert <em>Report Hub</em>
            </h1>
            <p className="masthead__tagline">A field report on the current state of the game</p>
          </div>
          <PublicNav active={active} />
        </header>
      ) : (
        <header className="dispatch-container nameplate">
          <div className="nameplate__row">
            <div className="nameplate__meta">Independent patch intelligence</div>
            <p className="nameplate__title">
              <Link href="/">
                Crimson Desert <em>Report Hub</em>
              </Link>
            </p>
            <div className="nameplate__meta nameplate__meta--right">{dateline}</div>
          </div>
          <PublicNav active={active} />
        </header>
      )}
      <main id="main-content">{children}</main>
      <PublicFooter />
    </>
  );
}

const OPERATOR_NAV: Array<{ key: OperatorNavKey | "export"; href: string; label: string }> = [
  { key: "review", href: "/admin", label: "REPORT REVIEW" },
  { key: "scanner", href: "/scanner", label: "SCANNER MONITOR" },
  { key: "compile", href: "/admin/compile", label: "COMPILE DOSSIER" },
  { key: "export", href: "/api/admin/export", label: "EXPORT CSV" },
];

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
    <>
      <div className="dispatch-topline dispatch-topline--operator" aria-hidden="true" />
      <header className="dispatch-container nameplate">
        <div className="nameplate__row">
          <div className="nameplate__meta nameplate__meta--operator">Operator console · signed in</div>
          <p className="nameplate__title">
            <Link href="/">
              Crimson Desert <em>Report Hub</em>
            </Link>
          </p>
          <div className="nameplate__meta nameplate__meta--right">{dispatchDateline()}</div>
        </div>
        <nav className="dispatch-nav dispatch-nav--operator" aria-label="Operator">
          {OPERATOR_NAV.map((item) =>
            item.key === "export" ? (
              <a key={item.key} href={item.href} className="dispatch-nav__link">
                {item.label}
              </a>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                className="dispatch-nav__link"
                aria-current={active === item.key ? "page" : undefined}
              >
                {item.label}
              </Link>
            ),
          )}
          <form action={signOutAdmin} style={{ display: "contents" }}>
            <button type="submit" className="dispatch-nav__link dispatch-nav__link--signout">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main id="main-content">{children}</main>
      <footer className="dispatch-footer">
        <p className="dispatch-footer__note">
          Operator surfaces are never linked publicly. Sessions expire 12 hours after sign-in.
        </p>
        <div className="dispatch-footer__links">
          <span>{family ? `OPERATOR · v${family} CONSOLE` : "OPERATOR CONSOLE"}</span>
        </div>
      </footer>
    </>
  );
}
