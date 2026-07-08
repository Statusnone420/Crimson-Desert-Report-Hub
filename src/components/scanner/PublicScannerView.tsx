import Link from "next/link";
import { SourceRadar } from "@/components/scanner/SourceRadar";
import type { IntegrationStatus } from "@/lib/env";
import type { PublicScannerData } from "@/lib/queries";

function timeAgo(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PublicScannerView({
  data,
  integrations,
  patchVersion,
}: {
  data: PublicScannerData;
  integrations: IntegrationStatus[];
  patchVersion: string;
}) {
  const scannerLabel = data.scannerConnected
    ? data.scannerActive
      ? `Scanner active · last checked ${timeAgo(data.lastCheckedAt)}`
      : "Scanner paused"
    : "Scanner not connected";
  const scannerBadgeClass = data.scannerConnected
    ? data.scannerActive
      ? "badge badge-green badge-dot"
      : "badge badge-amber badge-dot"
    : "badge badge-dim badge-dot";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Community signal · how evidence works</p>
          <h1 className="h-display">Scanner</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {`Crimson Desert ${patchVersion} reports start as scattered public chatter. The scanner filters that into a small evidence board: what looks real, what still needs another source, and what is already backed.`}
          </p>
        </div>
        <span className={scannerBadgeClass}>{scannerLabel}</span>
      </section>

      <SourceRadar data={data} integrations={integrations} />

      {!data.scannerConnected ? (
        <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          This local build is not connected to the scanner database, so the funnel is showing an empty offline view. On
          the live site, this same page fills from scanner runs without exposing private candidate text or rejected
          source URLs.
        </p>
      ) : null}

      <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
        Evidence rule: nothing is published until a second independent source or a verified player report confirms it.
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Privacy promise</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Raw submissions, rejected candidates, scanner logs, and source URLs that fail review stay private.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Evidence rule</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            A public issue needs an approved player report or corroboration from independent public sources.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Useful links first</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Published issues show source links and approved excerpts so readers can verify the signal themselves.
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/issues" className="btn">
          See verified issues
        </Link>
        <Link href="/report" className="btn btn-ghost">
          Submit a report
        </Link>
      </section>
    </div>
  );
}
