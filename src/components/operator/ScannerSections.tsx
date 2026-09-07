import type { ScannerAttention } from "@/lib/scannerAttention";

type ScannerHealthSummaryProps = {
  attention: ScannerAttention;
  scannerStatus: string;
  scannerStatusTone: string;
  nextAttempt: string;
  latestRun: string | null;
  radarAvailable: boolean;
  screened7d: number;
  retained7d: number;
  awaiting: number | null;
  dateCoverage: { withSourceDate: number; tracked: number } | null;
};

function metric(value: number | string, label: string, detail: string) {
  return <div className="workspace-field"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export function ScannerHealthSummary({
  attention,
  scannerStatus,
  scannerStatusTone,
  nextAttempt,
  latestRun,
  radarAvailable,
  screened7d,
  retained7d,
  awaiting,
  dateCoverage,
}: ScannerHealthSummaryProps) {
  const retainedShare = radarAvailable && screened7d > 0
    ? `${retained7d} / ${screened7d} (${((retained7d / screened7d) * 100).toFixed(1)}%)`
    : radarAvailable
      ? "0 / 0"
      : "Unknown";

  return (
    <section id="health" className="workspace-panel" aria-labelledby="scanner-health-title">
      <div className="workspace-panel-header workspace-toolbar">
        <div>
          <h2 id="scanner-health-title">Health and history</h2>
          <p>{attention.count === null ? "A required health read is unavailable." : attention.count === 0 ? "No named health checks require action." : `${attention.count} named health ${attention.count === 1 ? "check needs" : "checks need"} attention.`}</p>
        </div>
        <div className="workspace-actions">
          <span className={`workspace-badge ${scannerStatusTone}`}>{scannerStatus}</span>
          <span className="workspace-note">Next eligible attempt: {nextAttempt}</span>
        </div>
      </div>
      <div className="workspace-panel-body">
        <div className="workspace-grid scanner-health-grid">
          {metric(radarAvailable ? screened7d : "Unknown", "Automated screening events · 7d", "Includes repeat screening. It is not a count of human reviews or unique issues.")}
          {metric(awaiting ?? "Unknown", "Awaiting issue groups", "Current-patch private leads without corroboration. This is background inventory, not a task queue.")}
          {metric(retainedShare, "Retained-lead share · 7d", "Retained leads divided by automated screening events. This is not an accuracy measure.")}
          {metric(dateCoverage ? `${dateCoverage.withSourceDate} / ${dateCoverage.tracked}` : "Unknown", "Leads with source dates", "Only real source publication dates count; first-seen time is not a publication date.")}
        </div>
        {latestRun ? <p className="workspace-note">Latest completed run: {latestRun}</p> : <p className="workspace-note">No completed scan is recorded yet.</p>}
        {attention.items.length > 0 ? <div className="workspace-queue" aria-label="Named scanner health checks">
          {attention.items.map((item) => <article key={item.id} className="workspace-queue-item"><strong>{item.label}</strong><span>{item.detail}</span></article>)}
        </div> : null}
      </div>
    </section>
  );
}
