import Link from "next/link";
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

type Step = { key: string; value: number; name: string; desc: string; color: string };

export function PublicScannerView({
  data,
  integrations,
  patchVersion,
}: {
  data: PublicScannerData;
  integrations: IntegrationStatus[];
  patchVersion: string;
}) {
  const redditConnected = integrations.find((row) => row.key === "reddit")?.connected ?? false;
  const webConnected = integrations.find((row) => row.key === "web_search")?.connected ?? false;

  const steps: Step[] = [
    { key: "reviewed", value: data.reviewedThisWeek, name: "Reviewed", desc: "Gathered from public web, Steam & forums", color: "var(--green)" },
    { key: "filtered", value: data.filteredThisWeek, name: "Filtered as noise", desc: "Off-topic, wrong patch, not a bug report", color: "var(--amber)" },
    { key: "awaiting", value: data.awaiting, name: "Awaiting a 2nd source", desc: "Real, but needs corroboration", color: "var(--blue)" },
    { key: "published", value: data.published, name: "Published as evidence", desc: "Backed by independent sources", color: "var(--crimson)" },
  ];

  const sources = [
    { label: "Public web search", on: webConnected, note: webConnected ? "on" : "off" },
    { label: "Steam & forums", on: true, note: "on" },
    { label: "Reddit", on: redditConnected, note: redditConnected ? "on" : "coming soon" },
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="stat-label">Community signal · how it&apos;s verified</p>
          <h1 className="h-display">How the scanner works</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            {`This hub watches public sources for Crimson Desert ${patchVersion} problems, filters out the noise, and only publishes an issue once separate sources agree. Here is the pipeline, in the open.`}
          </p>
        </div>
        <span className={data.scannerActive ? "badge badge-green badge-dot" : "badge badge-amber badge-dot"}>
          {data.scannerActive ? `Scanner active · last checked ${timeAgo(data.lastCheckedAt)}` : "Scanner paused"}
        </span>
      </section>

      <section className="panel space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="h-section">From scattered posts to verified evidence</h2>
          <span className="badge badge-dim">Last 7 days</span>
        </div>
        <div className="grid gap-px overflow-hidden rounded-[var(--r-md)]" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", background: "var(--border)" }}>
          {steps.map((step) => (
            <div key={step.key} className="p-3" style={{ background: "var(--surface)" }}>
              <div className="stat-value" style={{ color: step.color, fontSize: "1.7rem" }}>
                {step.value}
              </div>
              <div className="mt-1.5 text-sm font-semibold">{step.name}</div>
              <div className="mt-0.5 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                {step.desc}
              </div>
            </div>
          ))}
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full">
          <span className="flex-1" style={{ background: "var(--green)" }} />
          <span className="flex-1" style={{ background: "var(--amber)" }} />
          <span className="flex-1" style={{ background: "var(--blue)" }} />
          <span className="flex-1" style={{ background: "var(--crimson)" }} />
        </div>
        <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
          {"Nothing here is a raw complaint dump. A report becomes public evidence only when a second independent source or a verified player report confirms it — everything else stays in review."}
        </p>
        {data.reviewedThisWeek === 0 ? (
          <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
            {`The scanner has been quiet lately${data.lastCheckedAt ? ` — it last checked ${timeAgo(data.lastCheckedAt)}` : ""}. These counts refresh as it runs.`}
          </p>
        ) : null}
      </section>

      <section className="panel space-y-3">
        <h2 className="h-section">Where it looks — and where it could do better</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {sources.map((source) => (
            <div key={source.label} className="panel-inset flex items-center justify-between gap-2 border p-3 text-sm">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: source.on ? "var(--green)" : "var(--amber)" }}
                />
                {source.label}
              </span>
              <span className={source.on ? "badge badge-green" : "badge badge-amber"}>{source.note}</span>
            </div>
          ))}
        </div>
        <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
          {"We show our gaps on purpose. When a source isn't connected, some issues take longer to reach a second source. The counts above are aggregates only — individual posts, authors, and rejected items are never shown."}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="panel space-y-1">
          <h3 className="text-sm font-semibold">Private by default</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            {"No accounts, ads, or trackers. Your raw words never appear — public text is a neutral summary. Rejected results stay private."}
          </p>
        </div>
        <div className="panel space-y-1">
          <h3 className="text-sm font-semibold">Evidence over opinion</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            {"Reports capture platform, severity, frequency, and hardware. An issue is published only when independent sources agree."}
          </p>
        </div>
        <div className="panel space-y-1">
          <h3 className="text-sm font-semibold">Official channel</h3>
          <p className="text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            {"Crash logs and PERS IDs still belong in Pearl Abyss support. This hub organizes the community signal — it is unofficial."}
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/issues" className="btn">
          See what&apos;s verified →
        </Link>
        <Link href="/report" className="btn btn-ghost">
          Submit a report →
        </Link>
      </section>
    </div>
  );
}
