"use client";

import { useActionState, useState } from "react";
import { compileDossierState } from "@/app/admin/compile-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { initialDossierCompileActionState, type DossierCompileActionState } from "@/lib/dossierCompileActionState";
import { ACTION_TRANSPORT_FAILURE_MESSAGE, isActionTransportFailure } from "@/lib/actionTransportFailure";

export type DossierRun = {
  id: string;
  createdAt: string;
  provider: string;
};

type SelectedDossier = DossierRun & { markdown: string };

type DossierWorkspaceProps = {
  aiAvailable: boolean;
  runs: DossierRun[];
  selected: SelectedDossier | null;
  requestedRunMissing: boolean;
  writesDisabled: boolean;
};

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
  return provider === "deterministic" ? "Deterministic" : `AI draft · ${provider}`;
}

function CopyButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2_500);
  }
  return <button type="button" className="workspace-button" onClick={copy}>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select the text" : "Copy to clipboard"}</button>;
}

export function DossierWorkspace({ aiAvailable, runs, selected, requestedRunMissing, writesDisabled }: DossierWorkspaceProps) {
  const [compileState, compileAction] = useActionState<DossierCompileActionState, FormData>(async (previous, formData) => {
    try {
      return await compileDossierState(previous, formData);
    } catch (error) {
      if (isActionTransportFailure(error)) return { status: "transport_error" as const, code: "transport" as const, message: ACTION_TRANSPORT_FAILURE_MESSAGE };
      throw error;
    }
  }, initialDossierCompileActionState);
  const [useAi, setUseAi] = useState(false);
  return (
    <div className="workspace-page dossier-workspace">
      <header className="workspace-heading">
        <div>
          <h1>Compile dossier</h1>
          <p>Prepare a support-ready snapshot from the current patch’s approved evidence. Review the output before sending it anywhere.</p>
        </div>
        <a className="workspace-button" href="/operator?view=dossiers">Open workspace link</a>
      </header>

      <section className="workspace-panel" aria-label="Compile dossier">
        <div className="workspace-panel-header"><h2>New dossier</h2><p>Compilation saves a private run. It does not contact Pearl Abyss or publish a report.</p></div>
        <form action={compileAction} className="workspace-panel-body workspace-toolbar" onReset={(event) => event.preventDefault()}>
          <fieldset disabled={writesDisabled} className="workspace-fieldset">
            <label className="workspace-note">
              <input type="checkbox" name="use_ai" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} disabled={!aiAvailable} />
              {aiAvailable ? " Draft prose with AI" : " AI drafting is unavailable because no AI key is configured"}
            </label>
            {aiAvailable ? <p className="workspace-note">AI drafting sends the dossier, including private report details and evidence links, to the configured AI provider.</p> : null}
            <SubmitButton className="workspace-button workspace-button--primary" pendingText="Compiling…">Compile now</SubmitButton>
            <p className="workspace-note">Counts, evidence selection, and source links are deterministic. AI only rewrites prose and can fall back to deterministic output.</p>
          </fieldset>
          {compileState.status !== "idle" ? <p className="workspace-error" role="alert" aria-live="polite">{compileState.message}</p> : null}
        </form>
      </section>

      <div className="workspace-split">
        <section className="workspace-panel" aria-label="Previous dossier runs">
          <div className="workspace-panel-header"><h2>Saved runs</h2><p>The ten most recent private snapshots.</p></div>
          <div className="workspace-panel-body workspace-queue">
            {runs.length === 0 ? <p className="workspace-empty">No dossiers have been compiled yet.</p> : runs.map((run) => (
              <a key={run.id} className={`workspace-queue-item${selected?.id === run.id ? " is-selected" : ""}`} href={`/operator?view=dossiers&run=${encodeURIComponent(run.id)}`} aria-current={selected?.id === run.id ? "page" : undefined}>
                <strong>{runDateLabel(run.createdAt)}</strong>
                <span className={run.provider === "deterministic" ? "workspace-badge workspace-badge--green" : "workspace-badge workspace-badge--amber"}>{modeLabel(run.provider)}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="workspace-panel" aria-label="Dossier output">
          <div className="workspace-panel-header"><h2>Output</h2><p>Saved text is read-only here. Focus the text to select it.</p></div>
          <div className="workspace-panel-body">
            {requestedRunMissing ? <p className="workspace-error" role="alert">That saved dossier is no longer available. Choose a run from the list or compile a new dossier.</p> : null}
            {selected ? <>
              <div className="workspace-toolbar"><span className="workspace-note">Generated {runDateLabel(selected.createdAt)}</span><span className={selected.provider === "deterministic" ? "workspace-badge workspace-badge--green" : "workspace-badge workspace-badge--amber"}>{modeLabel(selected.provider)}</span></div>
              <div className="workspace-field"><label htmlFor="dossier-markdown">Dossier text</label><textarea id="dossier-markdown" readOnly rows={24} defaultValue={selected.markdown} onFocus={(event) => event.currentTarget.select()} /></div>
              <div className="workspace-actions"><CopyButton markdown={selected.markdown} /></div>
            </> : <p className="workspace-empty">Select a saved run to inspect it, or compile a new dossier.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
