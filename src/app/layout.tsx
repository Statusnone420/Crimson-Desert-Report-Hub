import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crimson Desert Report Hub — unofficial community tracker",
  description:
    "Community-run tracker aggregating structured Crimson Desert bug and performance reports for patch 1.13.00. Not affiliated with Pearl Abyss.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/report", label: "Submit report" },
  { href: "/issues", label: "Issues" },
  { href: "/about", label: "About" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              <span style={{ color: "var(--crimson)" }}>Crimson Desert</span> report hub
            </Link>
            <nav className="flex gap-4 text-sm" style={{ color: "var(--text-dim)" }}>
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-[var(--text)]">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="border-t border-[var(--border)] py-6 text-center text-xs" style={{ color: "var(--text-dim)" }}>
          Unofficial fan-run tracker. Not affiliated with Pearl Abyss, Reddit, or X. No accounts, no ads, no tracking.
          For crash logs use Pearl Abyss&apos;s official support channels.
        </footer>
      </body>
    </html>
  );
}
