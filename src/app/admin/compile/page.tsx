import { compileDossier } from "@/app/admin/actions";
import { OperatorShell } from "@/components/dispatch/Chrome";
import { CopyDossierButton, DossierOutput } from "@/components/DossierOutput";
import { requireAdmin } from "@/lib/adminGuard";
import { features } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function runDateLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function modeLabel(provider: string): string {
  return provider === "deterministic" ? "DETERMINISTIC" : `AI DRAFT · ${provider.toUpperCase()}`;
}

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
    <OperatorShell active="compile">
      <div className="dispatch-container">
        <header className="dispatch-pagehead" style={{ paddingBottom: 32 }}>
          <div className="dispatch-pagehead__copy">
            <p className="dispatch-kicker dispatch-kicker--amber">Operator · Admin controls</p>
            <h1 className="dispatch-pagehead__title" style={{ fontSize: 44 }}>
              Compile Pearl Abyss dossier
            </h1>
            <p className="dispatch-pagehead__dek">
              Bundle the current patch&apos;s evidence — counts, verdicts, approved excerpts, reviewed links — into
              a document you can hand to official support.
            </p>
          </div>
        </header>

        <form action={compileDossier} className="compile-band">
          <label
            className="report-check"
            style={{ color: aiAvailable ? undefined : "var(--dispatch-faint)" }}
          >
            <input type="checkbox" name="use_ai" className="w-auto" disabled={!aiAvailable} />
            Draft with AI {aiAvailable ? "(free OpenRouter prose model)" : ": disabled, no AI key configured"}
          </label>
          <button className="dispatch-btn">Compile now</button>
          <span className="op-note">Aggregates are deterministic. AI only rewrites prose and falls back cleanly.</span>
        </form>

        {current ? (
          <div className="compile-output">
            <div className="mono-label">
              Generated {runDateLabel(current.created_at)} · {modeLabel(current.provider)}
            </div>
            <DossierOutput markdown={current.markdown} />
            <div className="flex flex-wrap items-center gap-4">
              <CopyDossierButton markdown={current.markdown} />
              <span className="op-note">Focus the box to select all.</span>
            </div>
          </div>
        ) : null}

        <div className="compile-runs">
          <div className="mono-label" style={{ display: "block", marginBottom: 8 }}>
            Previous runs
          </div>
          {(runs ?? []).map((item) => (
            <div key={item.id} className="compile-run-row">
              <a href={`/admin/compile?run=${item.id}`} className="dispatch-link">
                {runDateLabel(item.created_at)}
              </a>
              <span className="compile-run-row__mode">{modeLabel(item.provider)}</span>
            </div>
          ))}
          {(runs ?? []).length === 0 ? <p className="op-note">No runs yet.</p> : null}
        </div>
      </div>
    </OperatorShell>
  );
}
