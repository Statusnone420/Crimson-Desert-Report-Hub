import type { PublicScannerData } from "@/lib/queries";

type FunnelStep = {
  key: string;
  value: number;
  label: string;
  description: string;
  /** Semantic accents stay sparse: neutral by default, blue = leads, crimson = published. */
  accent?: "blue" | "crimson";
};

export function RadarFunnel({ data }: { data: PublicScannerData }) {
  const steps: FunnelStep[] = [
    {
      key: "reviewed",
      value: data.reviewedThisWeek,
      label: "Reviewed",
      description: "candidate sources checked",
    },
    {
      key: "filtered",
      value: data.filteredThisWeek,
      label: "Filtered",
      description: "noise removed",
    },
    {
      key: "awaiting",
      value: data.awaiting,
      label: "Awaiting",
      description: "needs corroboration",
      accent: "blue",
    },
    {
      key: "published",
      value: data.published,
      label: "Published",
      description: "cleared for the board",
      accent: "crimson",
    },
  ];
  const max = Math.max(...steps.map((step) => step.value), 1);
  const fillFor = (step: FunnelStep) =>
    step.accent === "crimson" ? "var(--crimson)" : step.accent === "blue" ? "var(--blue)" : "var(--text-faint)";
  const numColorFor = (step: FunnelStep) =>
    step.accent === "crimson" ? "var(--crimson-bright)" : step.accent === "blue" ? "var(--blue)" : "var(--ink-paper)";

  return (
    <div className="space-y-3.5">
      <div
        className="radar-funnel mt-1 grid gap-y-2.5"
        style={{ gridTemplateColumns: "6rem minmax(0, 1fr) auto" }}
        aria-hidden="true"
      >
        {steps.map((step) => (
          <div key={step.key} className="contents">
            <span className="stat-label self-center">{step.label}</span>
            <span
              className="platform-table__bar self-center"
              aria-hidden="true"
              style={{ marginRight: "0.9rem" }}
            >
              <span
                style={{
                  width: `${step.value > 0 ? Math.max(4, Math.round((step.value / max) * 100)) : 0}%`,
                  background: fillFor(step),
                }}
              />
            </span>
            <span className="num self-center text-base" style={{ color: numColorFor(step) }}>
              {step.value}
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {steps.map((step) => (
          <p key={step.key} className="text-xs" style={{ color: "var(--text-faint)" }}>
            <span style={{ color: "var(--text-dim)" }}>{step.label}</span> — {step.description}
          </p>
        ))}
      </div>
      <div className="chart-accessible-data">
        <table>
          <caption>Source radar funnel from reviewed candidates to published issues</caption>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Count</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.key}>
                <th scope="row">{step.label}</th>
                <td>{step.value}</td>
                <td>{step.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t pt-3 text-xs leading-5" style={{ borderColor: "var(--ink-rule)", color: "var(--text-faint)" }}>
        {data.lastCheckedAt
          ? `Last checked ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
              new Date(data.lastCheckedAt),
            )}.`
          : "No scanner run recorded yet."} {data.scannerActive ? "Scheduled scans are active." : "Scheduled scans are paused or unavailable."}
      </p>
    </div>
  );
}
