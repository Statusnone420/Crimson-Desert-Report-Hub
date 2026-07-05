export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: "crimson" | "amber" | "green" | "dim" }) {
  const toneColor =
    tone === "crimson" ? "#ff8a7a" : tone === "amber" ? "#f0c274" : tone === "green" ? "#86d6a0" : "var(--text-dim)";
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="text-xs" style={{ color: toneColor }}>{note}</div> : null}
    </div>
  );
}

export function MeterBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="meter">
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

const FIX_STATUS_META: Record<string, { label: string; cls: string }> = {
  reported: { label: "Reported", cls: "badge badge-dim" },
  acknowledged: { label: "PA acknowledged", cls: "badge badge-amber" },
  fix_claimed: { label: "Fix claimed", cls: "badge badge-amber" },
  verified_fixed: { label: "Verified fixed", cls: "badge badge-green" },
  persists: { label: "Persists after claimed fix", cls: "badge badge-crimson" },
};

export function FixStatusBadge({ status }: { status: string }) {
  const meta = FIX_STATUS_META[status] ?? FIX_STATUS_META.reported;
  return <span className={meta.cls}>{meta.label}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "seed_unverified") return <span className="badge badge-dim">Unverified seed</span>;
  if (confidence === "low") return <span className="badge badge-dim">Low confidence</span>;
  if (confidence === "medium") return <span className="badge badge-amber">Medium confidence</span>;
  return <span className="badge badge-green">Confirmed</span>;
}
