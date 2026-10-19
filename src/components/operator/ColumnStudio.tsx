import Link from "next/link";
import type { ReactNode } from "react";
import { deleteVoiceExampleAction, generateTestDraftAction, moveVoiceExampleAction, saveVoiceExampleAction } from "@/app/operator/column-actions";
import { CharacterCountField } from "@/components/operator/CharacterCountField";
import { SubmitButton } from "@/components/SubmitButton";
import { formatUtcTimestamp } from "@/lib/editorials/content";
import type { ColumnStudio as Studio } from "@/lib/editorials/feedback.server";
import { MAX_EXAMPLE_CHARACTERS, MAX_LABEL_CHARACTERS, MAX_VOICE_EXAMPLES } from "@/lib/editorials/feedbackForm";
import { WRITER_EFFORTS, WRITER_MODEL_LABELS, WRITER_MODELS, isWriterModel } from "@/lib/editorials/models";
import { TEST_DRAFTS_PER_DAY } from "@/lib/editorials/provider.server";

function Button({ disabled, children, pendingText = "Saving…", danger = false }: { disabled: boolean; children: ReactNode; pendingText?: string; danger?: boolean }) {
  const className = `workspace-button${danger ? " workspace-button--danger" : ""}`;
  return disabled ? <button type="submit" className={className} disabled>{children}</button> : <SubmitButton className={className} pendingText={pendingText}>{children}</SubmitButton>;
}

/** Voice examples, the approved editions rotating in, and A/B test drafts. */
export function ColumnStudio({ studio, writesDisabled }: { studio: Studio | null; writesDisabled: boolean }) {
  if (!studio) return <section className="workspace-panel workspace-empty">
    <h2>Voice and test drafts unavailable</h2>
    <p>The voice examples and test drafts could not be read for this page load. Nothing changed. Reload to try again.</p>
  </section>;
  const testsLeft = Math.max(0, TEST_DRAFTS_PER_DAY - studio.testsToday);
  return <>
    <section className="workspace-panel" aria-labelledby="column-voice-heading">
      <div className="workspace-panel-header"><div>
        <h2 id="column-voice-heading">Voice examples</h2>
        <p>Up to {MAX_VOICE_EXAMPLES}, in the order the writer reads them. It matches their tone and rhythm, never their facts or jokes.</p>
      </div></div>
      <div className="workspace-panel-body">
        {studio.examples.length ? <ol className="column-example-list">{studio.examples.map((example, index) => <li key={example.id}>
          <details>
            <summary><strong>{example.label ?? `Example ${index + 1}`}</strong> · {example.body.length.toLocaleString("en-US")} characters</summary>
            <form action={saveVoiceExampleAction} className="workspace-form">
              <input type="hidden" name="id" value={example.id} />
              <div className="workspace-field"><label htmlFor={`example-label-${example.id}`}>Label (optional)</label><input id={`example-label-${example.id}`} name="label" maxLength={MAX_LABEL_CHARACTERS} defaultValue={example.label ?? ""} /></div>
              <CharacterCountField name="body" label="Example text" limit={MAX_EXAMPLE_CHARACTERS} defaultValue={example.body} required />
              <div><Button disabled={writesDisabled}>Save example</Button></div>
            </form>
          </details>
          <div className="workspace-toolbar">
            <form action={moveVoiceExampleAction}><input type="hidden" name="id" value={example.id} /><input type="hidden" name="direction" value="up" /><Button disabled={writesDisabled || index === 0} pendingText="Moving…">Move up</Button></form>
            <form action={moveVoiceExampleAction}><input type="hidden" name="id" value={example.id} /><input type="hidden" name="direction" value="down" /><Button disabled={writesDisabled || index === studio.examples.length - 1} pendingText="Moving…">Move down</Button></form>
            <form action={deleteVoiceExampleAction}><input type="hidden" name="id" value={example.id} /><Button disabled={writesDisabled} pendingText="Removing…" danger>Remove</Button></form>
          </div>
        </li>)}</ol> : <p className="workspace-note">No voice examples yet. The writer follows the style guide alone until you add some.</p>}
        {studio.examples.length < MAX_VOICE_EXAMPLES ? <details>
          <summary>Add a voice example</summary>
          <form action={saveVoiceExampleAction} className="workspace-form">
            <div className="workspace-field"><label htmlFor="example-label-new">Label (optional)</label><input id="example-label-new" name="label" maxLength={MAX_LABEL_CHARACTERS} /></div>
            <CharacterCountField name="body" label="Example text" limit={MAX_EXAMPLE_CHARACTERS} required />
            <div><Button disabled={writesDisabled}>Add example</Button></div>
          </form>
        </details> : <p className="workspace-note">Five examples is the limit. Remove one to add another.</p>}
        <p className="workspace-note">{studio.rotation.length
          ? `Approved editions rotating in: ${studio.rotation.map((edition) => edition.title).join("; ")}.`
          : "No approved editions rotate in yet. A thumbs up on an edition adds it, two at most."}</p>
      </div>
    </section>
    <section className="workspace-panel" aria-labelledby="column-tests-heading">
      <div className="workspace-panel-header"><div>
        <h2 id="column-tests-heading">Test drafts</h2>
        <p>Same fact pack, different writer. Test drafts are never published, never take a slot, and come out of the column budget. {testsLeft} of {TEST_DRAFTS_PER_DAY} left today (UTC).</p>
      </div></div>
      <div className="workspace-panel-body">
        <form action={generateTestDraftAction} className="workspace-form">
          <div className="workspace-grid column-cadence-grid">
            <div className="workspace-field"><label htmlFor="test-model">Writer</label>
              <select id="test-model" name="model" defaultValue="claude-sonnet-5-5">{WRITER_MODELS.map((model) => <option key={model} value={model}>{WRITER_MODEL_LABELS[model]}</option>)}</select>
            </div>
            <div className="workspace-field"><label htmlFor="test-effort">Effort</label>
              <select id="test-effort" name="effort" defaultValue="high">{WRITER_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select>
            </div>
          </div>
          <p className="workspace-note">A draft takes up to three minutes. Keep this page open until it finishes.</p>
          <div><Button disabled={writesDisabled || testsLeft === 0} pendingText="Writing… this can take a few minutes">Generate test draft</Button></div>
        </form>
      </div>
      {studio.tests.length ? <table className="workspace-table">
        <thead><tr><th scope="col">Draft</th><th scope="col">Writer</th><th scope="col">Result</th></tr></thead>
        <tbody>{studio.tests.map((row) => <tr key={row.id}>
          <td><strong>{row.title ? `TEST · ${row.title}` : "TEST · no draft"}</strong><small>{formatUtcTimestamp(row.created_at)}{row.title ? <> · <Link href={`/operator?view=column&edition=${row.id}`}>Read and rate</Link></> : null}</small></td>
          <td>{row.writer_model && isWriterModel(row.writer_model) ? WRITER_MODEL_LABELS[row.writer_model] : row.writer_model ?? "—"}{row.writer_effort ? <small>{row.writer_effort} effort</small> : null}</td>
          <td>{row.status === "skipped" ? `Skipped: ${row.skip_reason}` : row.status === "vetoed" ? "Vetoed" : "Draft"}</td>
        </tr>)}</tbody>
      </table> : <p className="workspace-panel-body workspace-note">No test drafts yet.</p>}
    </section>
  </>;
}
