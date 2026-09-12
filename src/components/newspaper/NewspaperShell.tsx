import Link from "next/link";
import type { ReactNode } from "react";
import { NewspaperHeader } from "./NewspaperHeader";
import { isVercelPreview } from "@/lib/previewGuard";
import { SITE_FEED_PATH, SITE_RSS_PATH, SOURCE_URL } from "@/lib/site";

export function NewspaperShell({ children, active, home = false }: { children: ReactNode; active?: string; home?: boolean }) {
  return (
    <div className="newspaper">
      <div className={`paper ${home ? "" : "article-paper"}`}>
        <NewspaperHeader active={active} home={home} />
        {isVercelPreview() && (
          <p className="np-preview">
            {process.env.CD_LOCAL_SNAPSHOT === "true"
              ? "Local preview · Copy of production data. Reports, check-ins and scans are disabled."
              : process.env.PREVIEW_SEED_FILE
                ? "Local demo · Sample data. Reports, check-ins and admin changes are disabled."
              : "Preview edition · Reports, check-ins and admin changes are disabled."}
          </p>
        )}
        <main id="main-content">{children}</main>
        <footer className="np-footer">
          <div className="np-footer-top">
            <p className="np-trust">No ads · No trackers</p>
            <div className="np-footer-links" role="navigation" aria-label="Footer navigation">
              <Link href="/watch">Watch</Link>
              <a href={SITE_RSS_PATH} aria-label="RSS feed for original reports">RSS</a>
              <a href={SITE_FEED_PATH} aria-label="Atom feed for original reports">Atom</a>
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy</Link>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">Open source</a>
              <Link href="/report">File a report →</Link>
            </div>
          </div>
          <p className="media-notice">
            Unofficial fan site. Game imagery © Pearl Abyss. Not affiliated with or endorsed by Pearl Abyss.{" "}
            <a href="https://crimsondesert.pearlabyss.com/en-US/Media?_mediatype=1" target="_blank" rel="noreferrer noopener">
              Image source ↗
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
