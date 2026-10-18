import type { Metadata } from "next";
import localFont from "next/font/local";
import { routeOpenGraph, SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import "./globals.css";
import "@/components/newspaper/newspaper.css";
import "@/components/newspaper/interactions.css";
import "@/components/newspaper/reading.css";
import "@/components/newspaper/information.css";
import "@/components/newspaper/dataDesk.css";
import "@/components/newspaper/operator.css";
import "@/components/operator/workspace.css";
import "@/components/catchup/catchup.css";
import { CatchUpProvider } from "@/components/catchup/CatchUpContext";
import { ProblemReportButton } from "@/components/ProblemReportButton";
import "@/components/problem-reports.css";

// The share images come from the opengraph-image.png / twitter-image.png file
// convention. Never set openGraph.images / twitter.images here: Next only
// attaches the files when the metadata object omits those keys.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CD Report Hub",
  },
  title: {
    default: SITE_SEARCH_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/", types: siteFeedAlternateTypes },
  openGraph: routeOpenGraph("/"),
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_OG_DESCRIPTION,
  },
  robots: process.env.VERCEL_ENV === "preview"
    ? { index: false, follow: false }
    : { index: true, follow: true, googleBot: { index: true, follow: true } },
};

// Keep Latin last within each face, matching the existing subset precedence.
const instrumentSans = localFont({
  src: [
    { path: "./fonts/instrument-sans-latin-ext.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/instrument-sans-latin.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-instrument-sans",
  display: "swap",
});
const instrumentSerif = localFont({
  src: [
    { path: "./fonts/instrument-serif-400-italic-latin-ext.woff2", weight: "400", style: "italic" },
    { path: "./fonts/instrument-serif-400-italic-latin.woff2", weight: "400", style: "italic" },
    { path: "./fonts/instrument-serif-400-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif-400-latin.woff2", weight: "400", style: "normal" },
  ],
  adjustFontFallback: "Times New Roman",
  variable: "--font-instrument-serif",
  display: "swap",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-cyrillic-ext.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-400-cyrillic.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-400-vietnamese.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-400-latin-ext.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-cyrillic-ext.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-cyrillic.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-vietnamese.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-latin-ext.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('newspaper-theme')||'light'}catch{}` }}/>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:border focus:bg-[var(--dispatch-inset)] focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <div className="dispatch-grain" aria-hidden="true" />
        <CatchUpProvider>{children}</CatchUpProvider>
        <ProblemReportButton />
      </body>
    </html>
  );
}
