"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ReportCaptcha } from "@/components/newspaper/ReportCaptcha";
import { PROBLEM_REPORT_LABELS, PROBLEM_REPORT_MAX_LENGTH, PROBLEM_REPORT_TYPES } from "@/lib/problemReports";

function ProblemReportDialog({ pageUrl, onClose, returnFocus }: { pageUrl: string; onClose: () => void; returnFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reducedMotion = useReducedMotion();
  const [type, setType] = useState<(typeof PROBLEM_REPORT_TYPES)[number]>("broken_link");
  const [token, setToken] = useState("");
  const [captchaGeneration, setCaptchaGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close(); document.body.style.overflow = overflow;
      // Presence completes before the native modal stops making the page inert.
      // Restore focus after that DOM commit, rather than in onExitComplete.
      requestAnimationFrame(returnFocus);
    };
  }, [returnFocus]);

  function keepFocusInDialog(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"));
    const first = fields[0];
    const last = fields.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token || !siteKey) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/problem-reports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, description: fields.get("description"), email: String(fields.get("email") ?? "").trim(), page_url: pageUrl, turnstile_token: token }),
      });
      if (response.ok) setSaved(true);
      else {
        const result = await response.json();
        setError(result.error === "rate_limited"
          ? "A report was already saved from this network in the last 24 hours. Please try again later."
          : result.error === "validation"
            ? "Add a description about the problem, with no more than two source links. Content removal requests need a valid email."
            : result.error === "captcha_failed"
              ? "The verification expired or failed. Please wait for a new check and try again."
              : "Reporting is temporarily unavailable. Please try again later.");
      }
    } catch { setError("Could not confirm the report was saved. Please try again later."); }
    finally {
      // Tokens are single-use. Remount only this widget to obtain a fresh token
      // after every attempt, without resetting any open issue check-in widget.
      setToken(""); setCaptchaGeneration((value) => value + 1); setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="problem-report-dialog" aria-labelledby="problem-report-title" aria-describedby="problem-report-purpose" onKeyDown={keepFocusInDialog} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <motion.div className="problem-report-surface" initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 5 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>
        <div className="problem-report-heading"><h2 id="problem-report-title">Report a problem</h2><button type="button" onClick={onClose} aria-label="Close problem report">Close</button></div>
        <p id="problem-report-purpose">A private note to Crimson Desert Report Hub about this website.</p>
        {saved ? <div className="problem-report-fields" role="status"><p>Report saved privately for review. Nothing changes automatically, and there is no promised response time.</p><button type="button" onClick={onClose}>Close</button></div> : (
          <form className="problem-report-form" onSubmit={submit} aria-busy={busy}>
            <div className="problem-report-fields">
            <label htmlFor="problem-report-type">Type</label>
            <select id="problem-report-type" name="type" value={type} onChange={(event) => setType(event.target.value as typeof type)} disabled={busy}>
              {PROBLEM_REPORT_TYPES.map((value) => <option key={value} value={value}>{PROBLEM_REPORT_LABELS[value]}</option>)}
            </select>
            <label htmlFor="problem-report-description">What needs attention?</label>
            <textarea id="problem-report-description" name="description" rows={4} required maxLength={PROBLEM_REPORT_MAX_LENGTH} disabled={busy} aria-describedby="problem-report-description-help" />
            <p id="problem-report-description-help" className="problem-report-help">Up to {PROBLEM_REPORT_MAX_LENGTH} characters. Leave out passwords and sensitive account details.</p>
            <label htmlFor="problem-report-email">Email {type === "remove_content" ? "(required for creator verification)" : "(optional)"}</label>
            <input id="problem-report-email" name="email" type="email" autoComplete="email" maxLength={254} required={type === "remove_content"} disabled={busy} aria-describedby="problem-report-email-help" />
            <p id="problem-report-email-help" className="problem-report-help">Stored privately. This form does not send email.</p>
            <p className="problem-report-page">Page: <span>{pageUrl}</span></p>
            <p className="problem-report-help">Private review only. About one report per network per day; IPs are stored only as salted hashes. No response schedule.</p>
            {siteKey ? <ReportCaptcha key={captchaGeneration} siteKey={siteKey} action="problem_report" onToken={setToken} onError={() => setError("Verification is unavailable. Please try again later.")} /> : <p role="status">Reporting is temporarily unavailable. Please try again later.</p>}
            </div>
            <div className="problem-report-actions">{error && <p className="problem-report-error" role="alert">{error}</p>}<button type="submit" disabled={busy || !token || !siteKey}>{busy ? "Saving…" : "Send private report"}</button></div>
          </form>
        )}
      </motion.div>
    </dialog>
  );
}

export function ProblemReportButton() {
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useCallback(() => trigger.current?.focus(), []);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  // Until the widget is configured there is nothing to send. Contact tells
  // readers that reporting has not opened when this button is missing.
  if (!process.env.NEXT_PUBLIC_PROBLEM_REPORT_TURNSTILE_SITE_KEY) return null;
  return <>
    <button ref={trigger} type="button" className="problem-report-trigger" aria-haspopup="dialog" onClick={() => {
      // Capture at opening, including after client navigation, without tracking
      // query parameters or fragments that might contain private information.
      setPageUrl(`${window.location.origin}${window.location.pathname}`);
    }}>Report a problem</button>
    <AnimatePresence>
      {pageUrl !== null && <ProblemReportDialog key="problem-report" pageUrl={pageUrl} onClose={() => setPageUrl(null)} returnFocus={returnFocus} />}
    </AnimatePresence>
  </>;
}
