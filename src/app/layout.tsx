import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import { routeOpenGraph, SITE_DESCRIPTION, SITE_NAME, SITE_OG_DESCRIPTION, SITE_SEARCH_TITLE, SITE_URL, siteFeedAlternateTypes } from "@/lib/site";
import "./globals.css";
import "@/components/newspaper/newspaper.css";
import "@/components/newspaper/operator.css";

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

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
        {children}
      </body>
    </html>
  );
}
