import type { ReactNode } from "react";
import type { IntegrationStatus } from "@/lib/env";
import type { PublicScannerData } from "@/lib/queries";

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function lastCheckedLabel(iso: string | null): string {
  return iso ? `Last checked ${timeAgo(iso)}` : "Not checked yet";
}

type Step = { key: string; value: number; name: string; desc: string; color: string };

export function SourceRadar({
  data,
  integrations,
  title = "Source Radar",
  description = "Public sources move through the same funnel every run: review, filter noise, hold weak leads, then publish only links that clear the board rules. Links remain leads, not player evidence.",
  actions,
}: {
  data: PublicScannerData;
  integrations: IntegrationStatus[];
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  const steps: Step[] = [
    {
      key: "reviewed",
      value: data.reviewedThisWeek,
      name: "Reviewed",
      desc: "Candidates checked in the last 7 days",
      color: "var(--green)",
    },
    {
      key: "filtered",
      value: data.filteredThisWeek,
      name: "Filtered",
      desc: "Wrong patch, off-topic, or not a player problem",
      color: "var(--amber)",
    },
    {
      key: "awaiting",
      value: data.awaiting,
      name: "Awaiting corroboration",
      desc: "Plausible lead, not enough sources yet",
      color: "var(--blue)",
    },
    {
      key: "published",
      value: data.published,
      name: "Published issues",
      desc: "Full cards with a report or reviewed link",
      color: "var(--crimson)",
    },
  ];
  const segmentTotal = steps.reduce((sum, step) => sum + Math.max(0, step.value), 0);
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
    <section className="panel space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="stat-label">Automated scanner</div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="h-section">{title}</h2>
            <span className={scannerBadgeClass}>{scannerLabel}</span>
            <span className="badge badge-dim">{lastCheckedLabel(data.lastCheckedAt)}</span>
          </div>
          <p className="max-w-prose text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {description}
          </p>
        </div>
        {actions ? <div className="w-full sm:w-auto">{actions}</div> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="panel-inset border p-3">
          <div className="stat-label">Live now</div>
          <div className="stat-value mt-1" style={{ color: "var(--green-bright)", fontSize: "1.6rem" }}>
            {data.published}
          </div>
        </div>
        <div className="panel-inset border p-3">
          <div className="stat-label">Watching</div>
          <div className="stat-value mt-1" style={{ color: "var(--amber-bright)", fontSize: "1.6rem" }}>
            {data.awaiting}
          </div>
        </div>
        <div className="panel-inset border p-3">
          <div className="stat-label">Kept this week</div>
          <div className="stat-value mt-1" style={{ fontSize: "1.6rem" }}>
            {data.keptThisWeek}
          </div>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-[var(--r-md)] sm:grid-cols-2 lg:grid-cols-4" style={{ background: "var(--border)" }}>
        {steps.map((step) => (
          <div key={step.key} className="min-h-32 p-3" style={{ background: "var(--surface-inset)" }}>
            <div className="stat-value" style={{ color: step.color, fontSize: "1.75rem" }}>
              {step.value}
            </div>
            <div className="mt-1.5 text-sm font-semibold">{step.name}</div>
            <div className="mt-0.5 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              {step.desc}
            </div>
          </div>
        ))}
      </div>

      <div className="flex h-1.5 gap-1 md:gap-2" aria-label="Source Radar funnel proportions">
        {steps.map((step) => (
          <div
            key={step.key}
            className="rounded-full"
            title={`${step.name}: ${step.value}`}
            style={{
              background: step.color,
              flexGrow: segmentTotal > 0 ? Math.max(0, step.value) : 1,
              flexBasis: 0,
              minWidth: step.value > 0 ? "1.25rem" : 0,
            }}
          />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {integrations.map((integration) => (
          <div key={integration.key} className="panel-inset border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{integration.label}</span>
              <span className={integration.connected && !integration.paused ? "badge badge-green" : "badge badge-amber"}>
                {integration.paused ? "Paused" : integration.connected ? "Connected" : "Off"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              {integration.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
