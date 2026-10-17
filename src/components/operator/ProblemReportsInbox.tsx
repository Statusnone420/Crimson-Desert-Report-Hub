"use client";

import { useRef, useState, type FormEvent } from "react";
import { externalWebHref } from "@/lib/externalWebHref";
import { PROBLEM_REPORT_LABELS, PROBLEM_REPORT_MAX_LENGTH, PROBLEM_REPORT_STATUSES, type ProblemReport, type ProblemReportStatus } from "@/lib/problemReports";

type Queue = { reports: ProblemReport[]; nextOffset: number | null };

function ReportReview({ report, disabled, onSaved }: { report: ProblemReport; disabled: boolean; onSaved: (report: ProblemReport) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const form = useRef<HTMLFormElement>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    const fields = new FormData(event.currentTarget);
    const note = String(fields.get("note") ?? "").trim();
    const status = String(fields.get("status")) as ProblemReportStatus;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/problem-reports/${report.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: report.revision, status, ...(note ? { note } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(response.status === 409 ? "This report changed in another session. Reload the inbox before saving." : response.status === 401 ? "Your session expired. Sign in again before saving." : "The review could not be saved. Your note is still here.");
        return;
      }
      onSaved({ ...report, status, revision: result.revision, updated_at: result.updated_at,
        private_notes: note ? [...report.private_notes, { text: note, created_at: result.updated_at }] : report.private_notes });
      form.current?.reset(); setMessage("Private review saved. No content was changed.");
    } catch { setMessage("Could not confirm the review was saved. Reload before retrying to avoid a duplicate note."); }
    finally { setBusy(false); }
  }
  const pageHref = externalWebHref(report.page_url);
  return <details className="problem-inbox-report" data-report-id={report.id}>
    <summary><strong>{PROBLEM_REPORT_LABELS[report.type]}</strong><span className="problem-inbox-status" data-status={report.status}>{report.status}</span><time dateTime={report.created_at}>{new Date(report.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</time></summary>
    <div className="problem-inbox-detail">
      <p>{pageHref ? <a href={pageHref} target="_blank" rel="noreferrer noopener">{report.page_url}</a> : report.page_url}</p>
      <p className="problem-inbox-text">{report.description}</p>
      <p>Private email: {report.email ?? "Not supplied"}</p>
      {report.type === "remove_content" && <p>Verify that the requester controls the creator&rsquo;s content before approving a removal.</p>}
      {report.private_notes.length > 0 && <section aria-label="Private review notes"><h2>Private notes</h2><ul>{report.private_notes.map((note, index) => <li key={`${note.created_at}-${index}`}><time dateTime={note.created_at}>{new Date(note.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</time><p className="problem-inbox-text">{note.text}</p></li>)}</ul></section>}
      <form ref={form} onSubmit={save} aria-busy={busy}>
        <fieldset disabled={disabled || busy}>
          <label htmlFor={`status-${report.id}`}>Status</label>
          <select key={report.revision} id={`status-${report.id}`} name="status" defaultValue={report.status}>{PROBLEM_REPORT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
          <label htmlFor={`note-${report.id}`}>Add a private note (optional)</label>
          <textarea id={`note-${report.id}`} name="note" rows={3} maxLength={PROBLEM_REPORT_MAX_LENGTH} />
          <button type="submit" className="workspace-button">{busy ? "Saving…" : "Save review"}</button>
        </fieldset>
        {message && <p role="status">{message}</p>}
      </form>
    </div>
  </details>;
}

export function ProblemReportsInbox({ initial, disabled }: { initial: Queue; disabled: boolean }) {
  const [queue, setQueue] = useState(initial);
  const [status, setStatus] = useState<ProblemReportStatus | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(nextStatus: typeof status, offset = 0) {
    if (busy) return;
    setBusy(true); setError("");
    const query = new URLSearchParams({ offset: String(offset), ...(nextStatus === "all" ? {} : { status: nextStatus }) });
    try {
      const response = await fetch(`/api/admin/problem-reports?${query}`, { cache: "no-store" });
      if (!response.ok) { setError(response.status === 401 ? "Your session expired. Sign in again." : "The inbox could not be read. Existing rows have been kept."); return; }
      const next = await response.json() as Queue;
      setStatus(nextStatus);
      setQueue((current) => ({ reports: offset ? [...current.reports, ...next.reports.filter((row) => !current.reports.some((existing) => existing.id === row.id))] : next.reports, nextOffset: next.nextOffset }));
    } catch { setError("The inbox could not be read. Existing rows have been kept."); }
    finally { setBusy(false); }
  }
  return <div className="workspace-page problem-inbox">
    <header className="workspace-heading"><div><h1>Reports inbox</h1><p>Private website problems and creator requests. Reports wait here without a response schedule.</p></div></header>
    <p>Approval marks the queue only. Every content change still needs separate approval; nothing is published or removed automatically.</p>
    {disabled && <p className="workspace-notice">Preview edition: report updates are disabled.</p>}
    <div className="problem-inbox-controls"><div className="problem-inbox-filter"><label htmlFor="problem-inbox-filter">Show status</label><select id="problem-inbox-filter" value={status} disabled={busy} onChange={(event) => void load(event.target.value as typeof status)}><option value="all">All</option>{PROBLEM_REPORT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></div><button type="button" className="workspace-button" disabled={busy} onClick={() => void load(status)}>Refresh inbox</button></div>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {queue.reports.length === 0 ? <p>No reports in this view.</p> : queue.reports.map((report) => <ReportReview key={report.id} report={report} disabled={disabled} onSaved={(saved) => setQueue((current) => ({ ...current, reports: current.reports.map((row) => row.id === saved.id ? saved : row) }))} />)}
    {queue.nextOffset !== null && <button type="button" className="workspace-button" disabled={busy} onClick={() => void load(status, queue.nextOffset!)}>Load older reports</button>}
  </div>;
}
