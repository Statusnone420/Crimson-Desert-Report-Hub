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

type Step = {
  key: string;
  value: number;
  name: string;
  desc: string;
  /** Sparse semantic accents: neutral by default, blue = held leads, crimson = published. */
  accent?: "blue" | "crimson";
};

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
    },
    {
      key: "filtered",
      value: data.filteredThisWeek,
      name: "Filtered",
      desc: "Wrong patch, off-topic, or not a player problem",
    },
    {
      key: "awaiting",
      value: data.awaiting,
      name: "Awaiting corroboration",
      desc: "Plausible lead, not enough sources yet",
      accent: "blue",
    },
    {
      key: "published",
      value: data.published,
      name: "Published issues",
      desc: "Full cards with a report or reviewed link",
      accent: "crimson",
    },
  ];
  const maxStep = Math.max(...steps.map((step) => step.value), 1);
  const scannerLabel = data.scannerConnected
    ? data.scannerActive
      ? "Scanner scheduled"
      : "Scanner paused"
    : "Scanner unavailable";
  const scannerTone = data.scannerConnected
    ? data.scannerActive
      ? "var(--green-bright)"
      : "var(--amber-bright)"
    : "var(--text-faint)";
  const scannerDot = data.scannerConnected
    ? data.scannerActive
      ? "var(--green)"
      : "var(--amber)"
    : "var(--text-faint)";

  return (
    <section className="brief-section radar-card">
      <div className="section-intro">
        <div className="min-w-0">
          <div className="eyebrow-row">
            <span className="eyebrow">Automated scanner</span>
            <span className="status-inline" style={{ color: scannerTone }}>
              <span aria-hidden="true" className="status-inline__dot" style={{ background: scannerDot }} />
              {scannerLabel}
            </span>
            <span className="num text-xs" style={{ color: "var(--text-faint)" }}>
              {lastCheckedLabel(data.lastCheckedAt)}
            </span>
          </div>
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
      </div>

      {actions ? <div className="mb-4">{actions}</div> : null}

      <div className="metric-strip" aria-label="Source radar funnel">
        {steps.map((step) => (
          <article
            key={step.key}
            className={
              step.accent === "crimson"
                ? "metric-card metric-card--crimson"
                : step.accent === "blue"
                  ? "metric-card metric-card--blue"
                  : "metric-card"
            }
          >
            <div className="eyebrow">{step.name}</div>
            <div
              className="metric-card__value num"
              style={
                step.accent
                  ? undefined
                  : { color: "var(--ink-paper)" }
              }
            >
              {step.value}
            </div>
            <div className="metric-card__bar" aria-hidden="true">
              <span style={{ width: `${step.value > 0 ? Math.max(4, Math.round((step.value / maxStep) * 100)) : 0}%` }} />
            </div>
            <p>{step.desc}</p>
          </article>
        ))}
      </div>

      <div
        className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b pb-4"
        style={{ borderColor: "var(--ink-rule)" }}
        aria-label="Board state"
      >
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          <span className="stat-label">Live now</span>{" "}
          <span className="num text-base" style={{ color: "var(--ink-paper)" }}>{data.published}</span>
        </span>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          <span className="stat-label">Watching</span>{" "}
          <span className="num text-base" style={{ color: "var(--ink-paper)" }}>{data.awaiting}</span>
        </span>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          <span className="stat-label">Kept this week</span>{" "}
          <span className="num text-base" style={{ color: "var(--ink-paper)" }}>{data.keptThisWeek}</span>
        </span>
      </div>

      <div className="rule-grid" style={{ borderTop: 0 }} aria-label="Scanner integrations">
        {integrations.map((integration) => (
          <div key={integration.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {integration.label}
              </span>
              <span
                className="num text-xs uppercase tracking-wide"
                style={{
                  color: integration.paused
                    ? "var(--amber-bright)"
                    : integration.connected
                      ? "var(--green-bright)"
                      : "var(--text-faint)",
                }}
              >
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
