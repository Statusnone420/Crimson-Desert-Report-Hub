import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { NavLinks } from "@/components/NavLinks";
import { AdminControls } from "@/components/AdminControls";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, SOURCE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "CD Report Hub",
  },
  title: {
    default: `${SITE_NAME} - current situation hub`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME} - current situation hub`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} - current situation hub`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
};

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:bg-[var(--surface-2)] focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <header className="site-header">
          <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3">
            <Link href="/" className="brand-mark">
              <Image
                aria-hidden="true"
                alt=""
                className="brand-logo"
                src="/brand/warrior-logo.png"
                width={32}
                height={32}
              />
              <span>
                <span style={{ color: "var(--crimson)" }}>Crimson Desert</span> Report Hub
              </span>
            </Link>
            <NavLinks />
          </div>
        </header>

        <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 md:py-10">
          {children}
        </main>

        <footer className="mt-8 border-t px-4 py-6 text-xs" style={{ color: "var(--text-faint)" }}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl leading-5">
              Unofficial, fan-run tracker. Not affiliated with Pearl Abyss, Reddit, or X. No accounts, no ads, no
              tracking. For crash logs, use Pearl Abyss&apos;s official support channels.
            </p>
            <div className="ml-auto flex items-center gap-4">
              <AdminControls />
              <a
                href={SOURCE_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 hover:text-[var(--text)]"
                aria-label="View source code on GitHub"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                Source
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
