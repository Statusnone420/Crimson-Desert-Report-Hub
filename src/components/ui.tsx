import type { ReactNode } from "react";
import { LADDER_DESCRIPTIONS, LADDER_LABELS, type EvidenceLadderState } from "@/lib/evidenceLadder";

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
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: Tone;
}) {
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-2">{value}</div>
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
}: {
  label?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        {label ? <div className="stat-label">{label}</div> : null}
        <h2 className="h-section">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
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
  reported: { label: "Reported", cls: "badge badge-dim" },
  acknowledged: { label: "PA acknowledged", cls: "badge badge-amber" },
  fix_claimed: { label: "Fix claimed", cls: "badge badge-amber" },
  verified_fixed: { label: "Verified fixed", cls: "badge badge-green badge-dot" },
  persists: { label: "Persists after fix", cls: "badge badge-crimson badge-dot" },
};

export function FixStatusBadge({ status, unverified = false }: { status: string; unverified?: boolean }) {
  if (unverified && status === "persists") {
    return <span className="badge badge-amber">Claimed-fix watch item</span>;
  }
  if (unverified && status === "reported") {
    return <span className="badge badge-dim">Watchlist item</span>;
  }
  const meta = FIX_STATUS_META[status] ?? FIX_STATUS_META.reported;
  return <span className={meta.cls}>{meta.label}</span>;
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

const LADDER_TONE_CLASS: Record<EvidenceLadderState, string> = {
  watching: "badge badge-dim",
  candidates: "badge badge-blue",
  corroborated: "badge badge-amber",
  player_confirmed: "badge badge-green",
};

/** Four-state public evidence ladder badge: watching → candidates → corroborated → player_confirmed. */
export function EvidenceLadderBadge({ state }: { state: EvidenceLadderState }) {
  return (
    <span className={LADDER_TONE_CLASS[state]} title={LADDER_DESCRIPTIONS[state]}>
      {LADDER_LABELS[state]}
    </span>
  );
}
