import type { ReactNode } from "react";
import { ADMIN_OVERRIDE_LABEL, LIFECYCLE_LABELS } from "@/lib/lifecycle";

type Tone = "crimson" | "amber" | "green" | "blue" | "dim";

const TONE_TEXT: Record<Tone, string> = {
  crimson: "var(--crimson-bright)",
  amber: "var(--amber-bright)",
  green: "var(--green-bright)",
  blue: "var(--blue)",
  dim: "var(--text-faint)",
};

const TONE_FILL: Record<Tone, string> = {
  crimson: "var(--crimson)",
  amber: "var(--amber)",
  green: "var(--green)",
  blue: "var(--blue)",
  dim: "var(--border-strong)",
};

export function StatCard({
  label,
  value,
  note,
  tone = "dim",
  valueTone,
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: Tone;
  valueTone?: Tone;
}) {
  return (
    <div className="panel">
      <div className="stat-label stat-label-zone">{label}</div>
      <div className="stat-value mt-2" style={valueTone ? { color: TONE_TEXT[valueTone] } : undefined}>
        {value}
      </div>
      {note ? (
        <div className="mt-1.5 text-xs font-medium" style={{ color: TONE_TEXT[tone] }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function MeterBar({ value, max, tone = "dim" }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="meter" role="presentation">
      <span style={{ width: `${pct}%`, background: TONE_FILL[tone] }} />
    </div>
  );
}

export function SectionHeader({
  label,
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  label?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Pages whose top heading is a SectionHeader pass "h1" so every page keeps exactly one h1. */
  as?: "h1" | "h2";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        {label ? <div className="stat-label">{label}</div> : null}
        <Heading className="h-section">{title}</Heading>
        {description ? (
          <p className="max-w-prose text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel panel-inset flex flex-col items-center gap-3 py-10 text-center">
      <div
        aria-hidden="true"
        className="h-9 w-9 rounded-full"
        style={{ border: "1px dashed var(--border-strong)", background: "var(--surface-2)" }}
      />
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? (
        <p className="max-w-md text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className ?? ""}`} style={style} aria-hidden="true" />;
}

const FIX_STATUS_META: Record<string, { label: string; cls: string }> = {
  reported: { label: LIFECYCLE_LABELS.reported, cls: "badge badge-dim" },
  acknowledged: { label: LIFECYCLE_LABELS.acknowledged, cls: "badge badge-amber" },
  fix_claimed: { label: LIFECYCLE_LABELS.fix_claimed, cls: "badge badge-amber" },
  verified_fixed: { label: LIFECYCLE_LABELS.verified_fixed, cls: "badge badge-green badge-dot" },
  persists: { label: LIFECYCLE_LABELS.persists, cls: "badge badge-crimson badge-dot" },
};

/** Admin-only: shows the stored fix_status (public surfaces render ReadoutBadge instead). */
export function FixStatusBadge({ status, adminOverride = false }: { status: string; adminOverride?: boolean }) {
  if (adminOverride) {
    return <span className="badge badge-blue">{ADMIN_OVERRIDE_LABEL}</span>;
  }
  const meta = FIX_STATUS_META[status] ?? FIX_STATUS_META.reported;
  return <span className={meta.cls}>{meta.label}</span>;
}

const READOUT_TONE_CLASS: Record<Tone, string> = {
  crimson: "badge badge-crimson",
  amber: "badge badge-amber",
  green: "badge badge-green",
  blue: "badge badge-blue",
  dim: "badge badge-dim",
};

/** The one public status badge: label + tone come from the readout composer. */
export function ReadoutBadge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={READOUT_TONE_CLASS[tone]}>{label}</span>;
}

/** Editorial variant of ReadoutBadge: dot + small caps, no pill chrome. */
export function ReadoutMark({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`readout-mark readout-mark--${tone}`}>{label}</span>;
}

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  blocking: { label: "Blocking", cls: "badge badge-crimson" },
  high: { label: "High severity", cls: "badge badge-crimson" },
  medium: { label: "Medium", cls: "badge badge-amber" },
  low: { label: "Low", cls: "badge badge-dim" },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.medium;
  return <span className={meta.cls}>{meta.label}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "seed_unverified") return <span className="badge badge-dim">Unverified watchlist</span>;
  if (confidence === "low") return <span className="badge badge-dim">Low confidence</span>;
  if (confidence === "medium") return <span className="badge badge-amber">Medium confidence</span>;
  return <span className="badge badge-green">Confirmed</span>;
}

/** Per-signal extraction confidence (low/medium/high) — distinct from cluster confidence above. */
export function SignalConfidenceBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  if (confidence === "high") return <span className="badge badge-green">High confidence</span>;
  if (confidence === "medium") return <span className="badge badge-amber">Medium confidence</span>;
  return <span className="badge badge-dim">Low confidence</span>;
}

