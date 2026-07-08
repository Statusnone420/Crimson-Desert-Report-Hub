import Link from "next/link";
import { SourceRadar } from "@/components/scanner/SourceRadar";
import type { IntegrationStatus } from "@/lib/env";
import type { PublicScannerData } from "@/lib/queries";

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
      ? "Scanner scheduled"
      : "Scanner paused"
    : "Scanner unavailable";
  const scannerBadgeClass = data.scannerConnected
    ? data.scannerActive
      ? "badge badge-green badge-dot"
      : "badge badge-amber badge-dot"
    : "badge badge-dim badge-dot";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Public source radar</p>
          <h1 className="h-display">Scanner</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {`Crimson Desert ${patchVersion} web chatter, filtered into source health, private leads, and publishable evidence.`}
          </p>
        </div>
        <span className={scannerBadgeClass}>{scannerLabel}</span>
      </section>

      <SourceRadar data={data} integrations={integrations} />

      {!data.scannerConnected ? (
        <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          Offline view. Scanner data is unavailable in this environment; private candidates and rejected URLs stay
          hidden.
        </p>
      ) : null}

      <p className="panel-inset border px-4 py-3 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
        Publishing requires an approved player report or a second independent source.
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Privacy</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            Raw submissions, rejected candidates, scanner logs, and source URLs that fail review stay private.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Publishing rule</h2>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            A public issue needs an approved player report or corroboration from independent public sources.
          </p>
        </div>
        <div className="panel space-y-1">
          <h2 className="text-sm font-semibold">Public evidence</h2>
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
