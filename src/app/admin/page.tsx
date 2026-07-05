import Link from "next/link";
import { moderateReport, setClusterFixStatus } from "@/app/admin/actions";
import { CATEGORY_LABELS, FIX_STATUSES, PLATFORM_LABELS } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createServiceClient();

  const { data: pending } = await supabase
    .from("bug_reports")
    .select("*")
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  const { data: clusters } = await supabase.from("issue_clusters").select("id, title, fix_status").order("title");

  const { data: dupes } = await supabase
    .from("bug_reports")
    .select("duplicate_fingerprint")
    .in("moderation_status", ["approved", "pending"]);

  const fingerprintCounts: Record<string, number> = {};
  for (const dupe of dupes ?? []) {
    fingerprintCounts[dupe.duplicate_fingerprint] = (fingerprintCounts[dupe.duplicate_fingerprint] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="stat-label">Admin</p>
          <h1 className="text-3xl font-semibold">Moderation queue ({pending?.length ?? 0})</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link className="btn btn-ghost" href="/admin/compile">
            Compile dossier
          </Link>
          <Link className="btn btn-ghost" href="/admin/source-monitor">
            Source monitor
          </Link>
          <a className="btn btn-ghost" href="/api/admin/export">
            Export CSV
          </a>
        </div>
      </section>

      {(pending ?? []).length === 0 ? (
        <div className="panel text-sm" style={{ color: "var(--text-dim)" }}>
          Queue is empty.
        </div>
      ) : null}

      <section className="space-y-3">
        {(pending ?? []).map((report) => (
          <article key={report.id} className="panel space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span className="badge badge-dim">
                {PLATFORM_LABELS[report.platform as keyof typeof PLATFORM_LABELS] ?? report.platform}
              </span>
              <span className="badge badge-dim">
                {CATEGORY_LABELS[report.category as keyof typeof CATEGORY_LABELS] ?? report.category}
              </span>
              <span className="badge badge-dim">
                {report.severity} / {report.frequency}
              </span>
              <span>patch {report.patch_version}</span>
              <span>{new Date(report.created_at).toLocaleString()}</span>
              {fingerprintCounts[report.duplicate_fingerprint] > 1 ? (
                <span className="badge badge-amber">possible duplicate x{fingerprintCounts[report.duplicate_fingerprint]}</span>
              ) : null}
            </div>

            <div>
              <p className="font-semibold">{report.issue_title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: "var(--text-dim)" }}>
                {report.description}
              </p>
              {report.repro_steps ? (
                <p className="mt-2 text-sm">
                  <span className="stat-label">Repro: </span>
                  {report.repro_steps}
                </p>
              ) : null}
              {report.hardware_specs ? (
                <p className="text-sm">
                  <span className="stat-label">Hardware: </span>
                  {report.hardware_specs}
                </p>
              ) : null}
              {report.evidence_url ? (
                <p className="text-sm">
                  <span className="stat-label">Evidence: </span>
                  <a href={report.evidence_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--blue)" }}>
                    {report.evidence_url}
                  </a>
                </p>
              ) : null}
              {report.pers_id ? (
                <p className="text-sm">
                  <span className="stat-label">PERS: </span>
                  {report.pers_id}
                </p>
              ) : null}
            </div>

            <form action={moderateReport} className="grid gap-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
              <input type="hidden" name="id" value={report.id} />
              <select name="cluster_id" defaultValue="">
                <option value="">No cluster</option>
                {(clusters ?? []).map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.title}
                  </option>
                ))}
              </select>
              <input name="excerpt" placeholder="Public excerpt, anonymized, max 500 chars" maxLength={500} />
              <button className="btn" name="decision" value="approved">
                Approve
              </button>
              <button className="btn btn-ghost" name="decision" value="rejected">
                Reject
              </button>
              <button className="btn btn-ghost" name="decision" value="spam">
                Spam
              </button>
            </form>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="stat-label mb-3">Cluster fix-status</div>
        <div className="space-y-2">
          {(clusters ?? []).map((cluster) => (
            <form key={cluster.id} action={setClusterFixStatus} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="cluster_id" value={cluster.id} />
              <span className="min-w-0 flex-1">{cluster.title}</span>
              <select name="fix_status" defaultValue={cluster.fix_status} className="w-56">
                {FIX_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost">Save</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
