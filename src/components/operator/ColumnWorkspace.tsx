import Link from "next/link";
import type { ReactNode } from "react";
import { approveEdition, publishTestDraft, saveStyleNote, setColumnPaused, vetoEdition } from "@/app/operator/column-actions";
import { currentWeekSlot } from "@/lib/editorials/cadence";
import { CharacterCountField } from "@/components/operator/CharacterCountField";
import { ColumnStudio } from "@/components/operator/ColumnStudio";
import type { ColumnStudio as Studio, EditionNote } from "@/lib/editorials/feedback.server";
import { MAX_NOTE_CHARACTERS } from "@/lib/editorials/feedbackForm";
import { ColumnCadence } from "@/components/operator/ColumnCadence";
import { SubmitButton } from "@/components/SubmitButton";
import { COLUMN_AUTHOR, factsBoxSchema, formatUtcTimestamp, markdownToSections } from "@/lib/editorials/content";
import { WRITER_MODEL_LABELS, isWriterModel, type ColumnProvider } from "@/lib/editorials/models";
import { skipReasonLabel } from "@/lib/editorials/notices";
import { previewStatusLabel } from "@/lib/editorials/previewFeed";
import type { AdminEditionRow, ColumnDashboard } from "@/lib/editorials/store.server";

function modelLabel(model: string | null): string {
  if (!model) return "—";
  return isWriterModel(model) ? WRITER_MODEL_LABELS[model] : model;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function countdown(publishAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((Date.parse(publishAt) - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function isVisible(row: AdminEditionRow, now: Date): boolean {
  return (row.status === "held" || row.status === "published") && !row.is_test && row.vetoed_at === null
    && row.publish_at !== null && Date.parse(row.publish_at) <= now.getTime();
}

/** Server-action buttons; preview builds render them disabled because writes are off there. */
function ActionButton({ className, pendingText, disabled, children }: { className: string; pendingText: string; disabled: boolean; children: ReactNode }) {
  return disabled
    ? <button type="submit" className={className} disabled>{children}</button>
    : <SubmitButton className={className} pendingText={pendingText}>{children}</SubmitButton>;
}

function VetoButton({ row, now, disabled }: { row: AdminEditionRow; now: Date; disabled: boolean }) {
  if (row.status !== "held" && row.status !== "published") return null;
  return <form action={vetoEdition}>
    <input type="hidden" name="id" value={row.id} />
    <ActionButton className="workspace-button workspace-button--danger" pendingText="Vetoing…" disabled={disabled}>
      {isVisible(row, now) ? "Unpublish" : "Veto"}
    </ActionButton>
  </form>;
}

/** This week's slot and its real row, if the card has one, for publishing a test draft in its place. */
type PublishSlot = { key: string; row: AdminEditionRow | null };

/** Notes come newest first. The newest thumbs counts, so a later thumbs down withdraws an approval. */
function newestThumbsIsUp(notes: EditionNote[]): boolean {
  return notes.find((note) => note.rating !== null)?.rating === "up";
}

/** An approved test draft can go live as this week's edition, in place of the slot's skip. */
function PublishTestDraft({ row, slot, approved, disabled }: { row: AdminEditionRow; slot: PublishSlot | null; approved: boolean; disabled: boolean }) {
  // The card lists the last five editions; a slot row older than that is checked by the database instead.
  const taken = slot?.row ? slot.row.status !== "skipped" : false;
  return <div className="workspace-panel-body column-feedback">
    <h3>Publish as this week&apos;s edition</h3>
    {slot === null ? <p className="workspace-note">This week&apos;s slot hasn&apos;t started yet, so there&apos;s nothing to publish this draft in place of.</p>
      : taken ? <p className="workspace-note">{`This week's slot (${slot.key}) already has an edition.`}</p>
      : !approved ? <p className="workspace-note">Give this draft a thumbs up first. Only a test draft whose newest rating is a thumbs up can be published.</p>
      : <form action={publishTestDraft} className="workspace-form">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="slotKey" value={slot.key} />
        <p className="workspace-note">{`Publishes this draft now as the edition for slot ${slot.key}${slot.row
          ? `, in place of its skip (${skipReasonLabel(slot.row.skip_reason, slot.row.check_note)})` : ""}. It goes on the site and in the feeds, and counts as one approve-first approval. Unpublish takes it down.`}</p>
        <label className="workspace-field column-checkbox"><input type="checkbox" name="confirm" value="yes" required /> I&apos;ve read this draft and want it live now.</label>
        <div><ActionButton className="workspace-button workspace-button--primary" pendingText="Publishing…" disabled={disabled}>Publish this draft</ActionButton></div>
      </form>}
  </div>;
}

function EditionDraft({ row, now, notes, publishSlot, writesDisabled }: { row: AdminEditionRow; now: Date; notes: EditionNote[] | null; publishSlot: PublishSlot | null; writesDisabled: boolean }) {
  const sections = row.body_md ? markdownToSections(row.body_md) : null;
  const facts = factsBoxSchema.safeParse(row.facts_box);
  const skipped = row.status === "skipped";
  return <section className="workspace-panel" aria-labelledby="column-draft-heading">
    <div className="workspace-detail-heading">
      <span className="workspace-badge">{row.is_test ? "Test draft" : skipped ? "Skipped" : previewStatusLabel(row, now)}</span>
      <h2 id="column-draft-heading">{row.title ?? `Slot ${row.slot_key}`}</h2>
      <p>By {COLUMN_AUTHOR} · {modelLabel(row.writer_model)}{row.writer_effort ? `, ${row.writer_effort} effort` : ""} · relevance {row.relevance_score ?? "not scored"}</p>
    </div>
    <div className="workspace-panel-body">
      {skipped ? <p className="workspace-note">{`Skipped: ${skipReasonLabel(row.skip_reason, row.check_note)}.${sections
        ? " This is the writer's draft. Nothing in it was fact-checked, and a skipped edition never publishes." : ""}`}</p> : null}
      {row.dek ? <p className="workspace-note">{row.dek}</p> : null}
      {sections ? sections.map((section) => <div className="workspace-detail-section" key={section.subhead}>
        <h3>{section.subhead}</h3>
        {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>) : skipped ? null : <p className="workspace-note">No text saved.</p>}
      {facts.success ? <div className="workspace-detail-section">
        <h3>What&apos;s actually true</h3>
        <ul>{facts.data.items.map((item) => <li key={item.text}>{item.text} <small>({item.sourceIds.join(", ")})</small></li>)}</ul>
      </div> : null}
    </div>
    {row.status !== "skipped" ? <div className="workspace-panel-body column-feedback">
      <h3>Rate this edition</h3>
      <form action={saveStyleNote} className="workspace-form">
        <input type="hidden" name="editorialId" value={row.id} />
        <fieldset className="workspace-field column-days">
          <legend>Thumbs</legend>
          <label><input type="radio" name="rating" value="up" /> Thumbs up</label>
          <label><input type="radio" name="rating" value="down" /> Thumbs down</label>
          <label><input type="radio" name="rating" value="" defaultChecked /> No rating</label>
        </fieldset>
        <CharacterCountField name="note" label="Note for the writer (optional)" limit={MAX_NOTE_CHARACTERS} rows={3} />
        <div><ActionButton className="workspace-button" pendingText="Saving…" disabled={writesDisabled}>Save note</ActionButton></div>
      </form>
      {notes === null ? <p className="workspace-note">Earlier notes could not be read.</p>
        : notes.length ? <ul className="column-notes">{notes.map((note) => <li key={note.id}>
          <strong>{note.rating === "up" ? "Thumbs up" : note.rating === "down" ? "Thumbs down" : "Note"}</strong> · {formatUtcTimestamp(note.created_at)}{note.note ? <p>{note.note}</p> : null}
        </li>)}</ul> : <p className="workspace-note">No notes on this edition yet.</p>}
    </div> : null}
    {/* Unread notes leave the thumbs-up check to the database. */}
    {row.is_test && row.status === "held"
      ? <PublishTestDraft row={row} slot={publishSlot} approved={notes === null || newestThumbsIsUp(notes)} disabled={writesDisabled} />
      : null}
    <div className="workspace-actions">
      <Link className="workspace-button" href="/operator?view=column">Back to the column</Link>
      {isVisible(row, now) && row.slug ? <Link className="workspace-button" href={`/editorials/${row.slug}`}>View on the site</Link> : null}
      {/* The card lists only the newest editions, so each edition's own page keeps its off switch. */}
      {row.is_test ? null : <VetoButton row={row} now={now} disabled={writesDisabled} />}
    </div>
  </section>;
}

/** A claim is a writer_failed skip until the edition is saved; a fresh one is still being written. */
function statusText(row: AdminEditionRow, now: Date): string {
  if (row.status === "skipped" && row.skip_reason === "writer_failed" && now.getTime() - Date.parse(row.created_at) < 5 * 60_000) return "Writing now";
  if (row.status === "skipped") return `Skipped: ${skipReasonLabel(row.skip_reason, row.check_note)}`;
  return previewStatusLabel(row, now);
}

export function ColumnWorkspace({ dashboard, draft, draftNotes = null, studio = null, notice, now, writesDisabled, keys }: {
  dashboard: ColumnDashboard | null;
  draft: AdminEditionRow | "unavailable" | null;
  draftNotes?: EditionNote[] | null;
  studio?: Studio | null;
  notice: string | null;
  now: Date;
  writesDisabled: boolean;
  keys: Record<ColumnProvider, boolean>;
}) {
  const weekSlot = dashboard?.state === "ready" ? currentWeekSlot(dashboard.settings, now) : null;
  const publishSlot = weekSlot && dashboard?.state === "ready"
    ? { key: weekSlot.key, row: dashboard.recent.find((row) => row.slot_key === weekSlot.key) ?? null }
    : null;
  return <div className="workspace-page column-workspace">
    <header className="workspace-heading">
      <div>
        <h1>Column</h1>
        <p>State of the Game, by {COLUMN_AUTHOR}. New editions wait here before they publish. Pause stops new editions; the rest of the site keeps running either way.</p>
      </div>
    </header>
    {notice ? <p className="workspace-notice" role="status">{notice}</p> : null}
    {writesDisabled ? <p className="workspace-notice">Preview edition: column changes are disabled here.</p> : null}
    {draft === "unavailable" ? <p className="workspace-error" role="status"><strong>Draft unavailable</strong>That edition could not be read for this page load. Reload to try again.</p>
      : draft ? <EditionDraft row={draft} now={now} notes={draftNotes} publishSlot={publishSlot} writesDisabled={writesDisabled} /> : null}
    {dashboard === null ? <section className="workspace-panel workspace-empty">
      <h2>Column record unavailable</h2>
      <p>The column&apos;s data could not be read for this page load. Nothing changed, and the public site is unaffected. Reload to try again.</p>
    </section> : dashboard.state === "not_set_up" ? <section className="workspace-panel workspace-empty">
      <h2>Not set up yet</h2>
      <p>The column&apos;s database update hasn&apos;t been applied. Until it is, no editions are written and the public site, feeds and scanner work as before.</p>
    </section> : <>
      <section className="workspace-panel" aria-labelledby="column-status-heading">
        <div className="workspace-panel-header">
          <div>
            <h2 id="column-status-heading">{dashboard.settings.paused ? "Paused" : "Running"}</h2>
            <p>{dashboard.settings.paused
              ? "No editions are written. Each scheduled slot records a skip, and nothing is made up after you resume."
              : "Editions are written at their scheduled slots when there is enough news."}</p>
          </div>
          <form action={setColumnPaused}>
            <input type="hidden" name="paused" value={dashboard.settings.paused ? "false" : "true"} />
            <ActionButton className={`workspace-button${dashboard.settings.paused ? " workspace-button--primary" : ""}`} pendingText="Saving…" disabled={writesDisabled}>
              {dashboard.settings.paused ? "Resume the column" : "Pause the column"}
            </ActionButton>
          </form>
        </div>
        <div className="workspace-panel-body">
          <p className="workspace-note">{dashboard.settings.approveFirstRemaining > 0
            ? `Approve-first: ${dashboard.settings.approveFirstRemaining} ${dashboard.settings.approveFirstRemaining === 1 ? "edition" : "editions"} left. Each new edition waits for your approval.`
            : `Approve-first is done. New editions publish after a ${dashboard.settings.holdHours}-hour hold unless you veto them.`}</p>
          <p className="workspace-note">Spent this month ({dashboard.spend.month}, UTC): {usd(dashboard.spend.spentUsd)} of {usd(dashboard.spend.capUsd)}.</p>
        </div>
      </section>
      <section className="workspace-panel" aria-labelledby="column-pending-heading">
        <div className="workspace-panel-header"><div><h2 id="column-pending-heading">Waiting to publish</h2><p>Approve or veto before the hold ends.</p></div></div>
        {dashboard.pending.length ? <table className="workspace-table">
          <thead><tr><th scope="col">Edition</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{dashboard.pending.map((row) => <tr key={row.id}>
            <td><strong>{row.title}</strong><small>{modelLabel(row.writer_model)} · relevance {row.relevance_score ?? "not scored"} · <Link href={`/operator?view=column&edition=${row.id}`}>Read the draft</Link></small></td>
            <td>{row.publish_at === null ? "Waiting for approval" : <>Publishes {formatUtcTimestamp(row.publish_at)}<small>in {countdown(row.publish_at, now)}</small></>}</td>
            <td><div className="workspace-toolbar">
              {row.publish_at === null ? <form action={approveEdition}>
                <input type="hidden" name="id" value={row.id} />
                <ActionButton className="workspace-button workspace-button--primary" pendingText="Publishing…" disabled={writesDisabled}>Approve and publish</ActionButton>
              </form> : null}
              <VetoButton row={row} now={now} disabled={writesDisabled} />
            </div></td>
          </tr>)}</tbody>
        </table> : <p className="workspace-panel-body workspace-note">Nothing is waiting.</p>}
      </section>
      <section className="workspace-panel" aria-labelledby="column-recent-heading">
        <div className="workspace-panel-header"><div><h2 id="column-recent-heading">Last 5 editions</h2><p>Skipped slots are listed with their reason.</p></div></div>
        {dashboard.recent.length ? <table className="workspace-table">
          <thead><tr><th scope="col">Edition</th><th scope="col">Status</th><th scope="col">Relevance</th><th scope="col">Writer</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{dashboard.recent.map((row) => <tr key={row.id}>
            <td><strong>{row.title ?? `Slot ${row.slot_key}`}</strong><small>{formatUtcTimestamp(row.created_at)}{row.status === "skipped" && !row.body_md ? null : <> · <Link href={`/operator?view=column&edition=${row.id}`}>Read</Link></>}</small></td>
            <td>{statusText(row, now)}</td>
            <td>{row.relevance_score ?? "—"}</td>
            <td>{modelLabel(row.writer_model)}</td>
            <td><VetoButton row={row} now={now} disabled={writesDisabled} /></td>
          </tr>)}</tbody>
        </table> : <p className="workspace-panel-body workspace-note">No editions yet.</p>}
      </section>
      <ColumnCadence settings={dashboard.settings} keys={keys} now={now} writesDisabled={writesDisabled} />
      <ColumnStudio studio={studio} writesDisabled={writesDisabled} />
    </>}
  </div>;
}
