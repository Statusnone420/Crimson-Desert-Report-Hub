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
            <p className="np-trust">No ads · No trackers</p>
            <div className="np-footer-links" role="navigation" aria-label="Footer navigation">
              <ReadingLink variant="quiet" href="/watch">Watch</ReadingLink>
              <ReadingLink variant="quiet" native href={SITE_RSS_PATH} aria-label="RSS feed for original reports">RSS</ReadingLink>
              <ReadingLink variant="quiet" native href={SITE_FEED_PATH} aria-label="Atom feed for original reports">Atom</ReadingLink>
              <ReadingLink variant="quiet" href="/about">About</ReadingLink>
              <ReadingLink variant="quiet" href="/privacy">Privacy</ReadingLink>
              <ReadingLink variant="quiet" href={SOURCE_URL}>Open source</ReadingLink>
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
