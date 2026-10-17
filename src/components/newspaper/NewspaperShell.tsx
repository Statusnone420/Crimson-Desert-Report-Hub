import { ReadingLink } from "./ReadingLink";
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
              ? "Local preview · Copy of production data. Check-ins and scans are disabled."
              : process.env.PREVIEW_SEED_FILE
                ? "Local demo · Sample data. Check-ins and admin changes are disabled."
                : "Preview edition · Check-ins and admin changes are disabled."}
          </p>
        )}
        <main id="main-content">{children}</main>
        <footer className="np-footer">
          <div className="np-footer-top">
            <p className="np-trust">
              No ads · No trackers
              <a className="np-source-link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener" aria-label="Source code on GitHub">
                <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 3.86c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
              </a>
            </p>
            <div className="np-footer-links" role="navigation" aria-label="Footer navigation">
              <ReadingLink variant="quiet" href="/watch">Watch</ReadingLink>
              <ReadingLink variant="quiet" native href={SITE_RSS_PATH} aria-label="RSS feed for reports and patch rundowns">RSS</ReadingLink>
              <ReadingLink variant="quiet" native href={SITE_FEED_PATH} aria-label="Atom feed for reports and patch rundowns">Atom</ReadingLink>
              <ReadingLink variant="quiet" href="/about">About</ReadingLink>
              <ReadingLink variant="quiet" href="/contact">Contact</ReadingLink>
              <ReadingLink variant="quiet" href="/privacy">Privacy</ReadingLink>
              <ReadingLink variant="quiet" href="/issues">Add a check-in</ReadingLink>
            </div>
          </div>
          <p className="media-notice">
            Unofficial fan site. Game imagery © Pearl Abyss. Not affiliated with or endorsed by Pearl Abyss.{" "}
            <ReadingLink variant="quiet" href="https://crimsondesert.pearlabyss.com/en-US/Media?_mediatype=1">Image source</ReadingLink>
          </p>
        </footer>
      </div>
    </div>
  );
}
