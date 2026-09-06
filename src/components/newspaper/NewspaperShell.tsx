import Link from "next/link";
import type { ReactNode } from "react";
import { AdminControls } from "@/components/AdminControls";
import { NewspaperHeader } from "./NewspaperHeader";
import { isVercelPreview } from "@/lib/previewGuard";
import { SOURCE_URL } from "@/lib/site";

export function NewspaperShell({ children, active, home = false }: { children: ReactNode; active?: string; home?: boolean }) {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="newspaper">
      <div className={`paper ${home ? "" : "article-paper"}`}>
        <NewspaperHeader active={active} home={home} date={date} />
        {isVercelPreview() && (
          <p className="np-preview">
            {process.env.CD_LOCAL_SNAPSHOT === "true"
              ? "Local preview · Copy of production data. Reports, check-ins and scans are disabled."
              : "Preview edition · Reports, check-ins and admin changes are disabled."}
          </p>
        )}
        <main id="main-content">{children}</main>
        <footer className="np-footer">
          <p className="np-trust">
            No ads · No trackers ·{" "}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
              Open source
            </a>
          </p>
          <div className="np-footer-links">
            <Link href="/about">About</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/report">File a report →</Link>
            <AdminControls />
          </div>
        </footer>
        <p className="media-notice">
          Unofficial fan site. Game imagery © Pearl Abyss. Not affiliated with or endorsed by Pearl Abyss.{" "}
          <a href="https://crimsondesert.pearlabyss.com/en-US/Media?_mediatype=1" target="_blank" rel="noreferrer noopener">
            Image source ↗
          </a>
        </p>
      </div>
    </div>
  );
}
