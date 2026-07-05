import { compileDossier } from "@/app/admin/actions";
import { DossierOutput } from "@/components/DossierOutput";
import { requireAdmin } from "@/lib/adminGuard";
import { features } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CompilePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await requireAdmin();
  const { run } = await searchParams;
  const supabase = createServiceClient();
  const aiAvailable = features().ai;

  const { data: runs } = await supabase
    .from("dossier_runs")
    .select("id, created_at, provider")
    .order("created_at", { ascending: false })
    .limit(10);

  let current: { markdown: string; provider: string; created_at: string } | null = null;
  if (run) {
    const { data } = await supabase.from("dossier_runs").select("markdown, provider, created_at").eq("id", run).single();
    current = data;
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="stat-label">Admin deliverable</p>
        <h1 className="text-3xl font-semibold tracking-tight">Compile Pearl Abyss dossier</h1>
      </section>

      <form action={compileDossier} className="panel flex flex-wrap items-center gap-4">
        <label
          className="flex w-auto items-center gap-2 text-sm"
          style={{ color: aiAvailable ? "var(--text)" : "var(--text-dim)" }}
        >
          <input type="checkbox" name="use_ai" className="w-auto" disabled={!aiAvailable} />
          Draft with AI {aiAvailable ? "(Groq/OpenRouter free tier)" : ": disabled, no AI key configured"}
        </label>
        <button className="btn">Compile now</button>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          Deterministic aggregates always. AI only rewrites prose and fails back to deterministic.
        </span>
      </form>

      {current ? (
        <div className="panel space-y-3">
          <span className="stat-label">
            Generated {new Date(current.created_at).toLocaleString()} · provider: {current.provider}
          </span>
          <DossierOutput markdown={current.markdown} />
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Focus the box to select all.
          </p>
        </div>
      ) : null}

      <div className="panel">
        <div className="stat-label mb-2">Previous runs</div>
        {(runs ?? []).map((item) => (
          <a key={item.id} href={`/admin/compile?run=${item.id}`} className="block py-1 text-sm" style={{ color: "var(--blue)" }}>
            {new Date(item.created_at).toLocaleString()} - {item.provider}
          </a>
        ))}
        {(runs ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No runs yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
