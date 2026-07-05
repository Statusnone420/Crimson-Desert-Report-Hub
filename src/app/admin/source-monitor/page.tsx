import { runRedditMonitor } from "@/app/admin/actions";
import { CATEGORY_LABELS } from "@/lib/constants";
import { features } from "@/lib/env";
import { requireAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SourceMonitorPage() {
  await requireAdmin();
  const f = features();
  const supabase = createServiceClient();
  const { data: signals } = await supabase
    .from("source_signals")
    .select("id, source, source_url, summary, category, confidence, observed_at")
    .order("observed_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <section>
        <p className="stat-label">Admin evidence intake</p>
        <h1 className="text-3xl font-semibold tracking-tight">Source monitor</h1>
      </section>

      <div className="panel space-y-3">
        <div className="stat-label">Reddit official OAuth API</div>
        {f.reddit ? (
          <form action={runRedditMonitor} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="subreddits">Subreddits, comma-separated, max 5</label>
              <input id="subreddits" name="subreddits" defaultValue="CrimsonDesert" />
            </div>
            <button className="btn">Run monitor now</button>
          </form>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Disabled: set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT to enable. The site is fully
            functional without it.
          </p>
        )}
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Raw post text auto-purges after 48 hours. Summaries, categories, and source URLs remain internal evidence and
          never appear on public pages.
        </p>
      </div>

      <div className="panel space-y-3">
        <div className="stat-label">X / xAI search</div>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          {f.xSearch
            ? "XAI_API_KEY detected: automated X search is available, with paid usage per run."
            : "Dormant: automated X search requires a paid xAI key. X evidence still flows in through the report form evidence link, verified by a moderator."}
        </p>
      </div>

      <div className="panel">
        <div className="stat-label mb-2">Recent signals ({signals?.length ?? 0})</div>
        {(signals ?? []).map((signal) => (
          <div key={signal.id} className="border-b py-2 text-sm last:border-0" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span className="badge badge-dim">{signal.source}</span>
              <span className="badge badge-dim">
                {CATEGORY_LABELS[signal.category as keyof typeof CATEGORY_LABELS] ?? signal.category}
              </span>
              <span>{signal.confidence} confidence</span>
              <span>{new Date(signal.observed_at).toLocaleString()}</span>
            </div>
            <p className="mt-1">{signal.summary}</p>
            <a
              href={signal.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs"
              style={{ color: "var(--blue)" }}
            >
              {signal.source_url}
            </a>
          </div>
        ))}
        {(signals ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No signals yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
