"use client";

import Link from "next/link";
import { ReportCaptcha } from "@/components/newspaper/ReportCaptcha";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FREQUENCIES,
  PLATFORM_LABELS,
  PLATFORMS,
  SEVERITIES,
} from "@/lib/constants";
import {
  blankReportDraft,
  type ReportDraft,
  type ReportDraftErrors,
  type ReportPatchMetadata,
  validateReportDraft,
} from "@/lib/reportDraft";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const CATEGORY_ART: Record<(typeof CATEGORIES)[number], { icon?: string; tone: string }> = {
  performance: { icon: "gauge", tone: "blue" },
  crash_startup: { icon: "triangle-alert", tone: "gold" },
  controls_gameplay: { icon: "gamepad-2", tone: "red" },
  graphics_visual: { icon: "aperture", tone: "green" },
  audio: { tone: "violet" },
  quest_progression: { icon: "scroll-text", tone: "gold" },
  other: { icon: "wrench", tone: "slate" },
};

const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], [string, string]> = {
  low: ["Minor", "A small annoyance"],
  medium: ["Disruptive", "Gets in the way"],
  high: ["Serious", "Hard to keep playing"],
  blocking: ["Blocking", "Cannot continue"],
};

const FREQUENCY_LABELS: Record<(typeof FREQUENCIES)[number], string> = {
  once: "Once",
  sometimes: "Sometimes",
  often: "Often",
  always: "Every time",
};

const DETAIL_FIELDS = [
  ["repro_steps", "Steps to reproduce", 2000, 3],
  ["expected_behavior", "What you expected", 1000, 2],
  ["actual_behavior", "What happened instead", 1000, 2],
  ["location_quest", "Location or quest", 200, 1],
  ["hardware_specs", "Hardware", 500, 2],
  ["graphics_mode", "Graphics mode or FPS setting", 200, 1],
  ["driver_os", "Driver and OS version", 200, 1],
  ["troubleshooting_tried", "What you already tried", 1000, 3],
  ["evidence_url", "Evidence link", 500, 1],
  ["pers_id", "Pearl Abyss PERS ID", 50, 1],
] as const;

type DetailFieldName = (typeof DETAIL_FIELDS)[number][0];

function FieldError({ name, error }: { name: string; error?: string }) {
  return error ? <p className="filing-error" id={`${name}-error`} role="alert">{error}</p> : null;
}

function TextField({
  draft,
  errors,
  change,
  name,
  label,
  limit,
  rows = 1,
  required = false,
  hint,
  placeholder,
}: {
  draft: ReportDraft;
  errors: ReportDraftErrors;
  change: (name: keyof ReportDraft, value: string) => void;
  name: DetailFieldName | "issue_title" | "description";
  label: string;
  limit: number;
  rows?: number;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  const error = errors[name];
  const inputProps = {
    id: name,
    name,
    value: draft[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(name, event.target.value),
    maxLength: limit,
    required,
    "aria-invalid": Boolean(error),
    "aria-describedby": `${name}-hint${error ? ` ${name}-error` : ""}`,
    placeholder,
  };

  return (
    <div className="filing-field">
      <label htmlFor={name}>{label}{!required ? <span>Optional</span> : null}</label>
      {rows > 1 ? <textarea {...inputProps} rows={rows} /> : <input {...inputProps} type={name === "evidence_url" ? "url" : "text"} />}
      <div className="filing-field-note" id={`${name}-hint`}>
        <span>{hint}</span>
        {rows > 1 ? <span>{draft[name].length.toLocaleString()} / {limit.toLocaleString()}</span> : null}
      </div>
      <FieldError name={name} error={error} />
    </div>
  );
}

export function ReportForm({
  currentPatch,
  patchVersions,
}: {
  currentPatch: ReportPatchMetadata;
  patchVersions: string[];
}) {
  const [draft, setDraft] = useState<ReportDraft>(() => blankReportDraft(currentPatch));
  const [errors, setErrors] = useState<ReportDraftErrors>({});
  const [review, setReview] = useState<ReturnType<typeof validateReportDraft>["data"]>(null);
  const [stage, setStage] = useState<"write" | "review">("write");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const reviewRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (stage === "review") reviewRef.current?.focus();
  }, [stage]);

  function change(name: keyof ReportDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setMessage("");
    setStatus("idle");
  }

  function focusField(name: string) {
    const target = document.getElementById(name);
    target?.closest("details")?.setAttribute("open", "");
    if (target instanceof HTMLFieldSetElement) {
      target.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    target?.focus();
  }

  function prepareReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateReportDraft(draft);
    setErrors(result.errors);
    setMessage("");
    setStatus("idle");
    if (!result.data) {
      focusField(Object.keys(result.errors)[0] ?? "issue_title");
      return;
    }
    setReview(result.data);
    setStage("review");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrors({});
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const payload = { ...draft, turnstile_token: String(formData.get("cf-turnstile-response") ?? "") };

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setStatus("done");
        return;
      }

      const nextErrors = Object.fromEntries(
        Object.entries(data.issues ?? {}).map(([name, messages]) => [
          name,
          Array.isArray(messages) ? messages[0] : messages,
        ]),
      ) as ReportDraftErrors;
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        setStage("write");
        setMessage("Something in the form needs fixing. Check the marked fields.");
      } else if (res.status === 429) {
        setMessage("Rate limit reached. The limit is 5 reports per hour from the same network.");
      } else if (data.error === "preview_writes_disabled") {
        setMessage("This preview cannot accept reports. Your draft is still here; send it from the live Report Hub.");
      } else if (res.status === 403) {
        setMessage("Spam check failed. Refresh the page and try again.");
      } else {
        setMessage("Could not send your report. Your details are still here. Check your connection and try again.");
      }
      setStatus("error");
    } catch {
      setStatus("error");
      setMessage("Could not send your report. Your details are still here. Check your connection and try again.");
    }
  }

  function resetForAnotherReport() {
    setDraft(blankReportDraft(currentPatch));
    setErrors({});
    setReview(null);
    setMessage("");
    setStatus("idle");
    setStage("write");
  }

  if (status === "done") {
    return (
      <section className="filing-success" aria-labelledby="filing-success-title">
        <p className="kicker">Report received</p>
        <h1 id="filing-success-title">Filed.</h1>
        <p>Your report is checked and sorted before it can affect the public record. Raw words stay private; public pages show counts and neutral summaries only.</p>
        <div className="filing-review-actions">
          <button type="button" onClick={resetForAnotherReport}>File another report</button>
          <Link href="/issues">See the Issue Board →</Link>
        </div>
      </section>
    );
  }

  const errorEntries = Object.entries(errors).filter(([, error]) => Boolean(error));
  const fieldProps = { draft, errors, change };

  return (
    <section id="report-form" className="filing-workspace" aria-label="Report form">
      <div className="filing-stages" aria-label="Report progress">
        <span aria-current={stage === "write" ? "step" : undefined}>Write your report</span>
        <span aria-hidden="true">→</span>
        <span aria-current={stage === "review" ? "step" : undefined}>Review and send</span>
      </div>
      <form onSubmit={stage === "write" ? prepareReview : submitReport} noValidate>
        {stage === "write" ? (
          <>
            {errorEntries.length > 0 ? (
              <div className="filing-errors" role="alert">
                <strong>A few details need your attention.</strong>
                <ul>{errorEntries.map(([name, error]) => <li key={name}><a href={`#${name}`} onClick={(event) => { event.preventDefault(); focusField(name); }}>{error}</a></li>)}</ul>
              </div>
            ) : null}
            {status === "error" && message ? <p className="filing-errors" role="alert">{message}</p> : null}

            <fieldset className="filing-section">
              <legend>Your game</legend>
              <div className="filing-row">
                <div className="filing-field">
                  <label htmlFor="platform">Platform</label>
                  <select id="platform" name="platform" value={draft.platform} required onChange={(event) => change("platform", event.target.value)} aria-invalid={Boolean(errors.platform)} aria-describedby={errors.platform ? "platform-error" : undefined}>
                    <option value="">Choose your platform</option>
                    {PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}
                  </select>
                  <FieldError name="platform" error={errors.platform} />
                </div>
                <div className="filing-field">
                  <label htmlFor="patch_version">Patch version</label>
                  <select id="patch_version" name="patch_version" value={draft.patch_version} required onChange={(event) => change("patch_version", event.target.value)} aria-invalid={Boolean(errors.patch_version)} aria-describedby={errors.patch_version ? "patch_version-error" : undefined}>
                    {patchVersions.map((patch) => <option key={patch} value={patch}>{patch === "other" ? "Other" : patch}</option>)}
                  </select>
                  <div className="filing-field-note" id="patch_version-hint">
                    <span>Filing against <a href={currentPatch.officialUrl} target="_blank" rel="noreferrer noopener">current patch {currentPatch.version} ↗</a>.</span>
                  </div>
                  <FieldError name="patch_version" error={errors.patch_version} />
                </div>
              </div>
              <fieldset className="filing-categories" id="category" aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "category-error" : undefined}>
                <legend>What kind of issue?</legend>
                <div className="filing-category-grid">
                  {CATEGORIES.map((category) => {
                    const art = CATEGORY_ART[category];
                    return (
                      <label key={category} className={`filing-category filing-tone-${art.tone} ${draft.category === category ? "is-selected" : ""}`}>
                        <input type="radio" name="category" value={category} checked={draft.category === category} onChange={() => change("category", category)} required />
                        {art.icon ? <span className="filing-category-icon" aria-hidden="true" style={{ maskImage: `url(/icons/${art.icon}.svg)` }} /> : <span className="filing-audio" aria-hidden="true">♪</span>}
                        <span>{CATEGORY_LABELS[category]}</span>
                      </label>
                    );
                  })}
                </div>
                <FieldError name="category" error={errors.category} />
              </fieldset>
            </fieldset>

            <fieldset className="filing-section">
              <legend>What happened?</legend>
              <TextField {...fieldProps} name="issue_title" label="A short, specific summary" limit={120} required placeholder="Opening the map freezes the game during combat" hint="Name the action and the problem it causes." />
              <TextField {...fieldProps} name="description" label="Describe the problem" limit={4000} rows={5} required placeholder="Where were you, what were you doing, and what happened?" hint="Use your own words. Leave out personal information." />
              <fieldset className="filing-choices" id="severity" aria-invalid={Boolean(errors.severity)} aria-describedby={errors.severity ? "severity-error" : undefined}>
                <legend>How much does it affect play?</legend>
                <div>{SEVERITIES.map((severity) => <label key={severity} className={draft.severity === severity ? "is-selected" : ""}><input type="radio" name="severity" value={severity} checked={draft.severity === severity} onChange={() => change("severity", severity)} required /><span>{SEVERITY_LABELS[severity][0]}<small>{SEVERITY_LABELS[severity][1]}</small></span></label>)}</div>
                <FieldError name="severity" error={errors.severity} />
              </fieldset>
              <fieldset className="filing-choices" id="frequency" aria-invalid={Boolean(errors.frequency)} aria-describedby={errors.frequency ? "frequency-error" : undefined}>
                <legend>How often has it happened?</legend>
                <div>{FREQUENCIES.map((frequency) => <label key={frequency} className={draft.frequency === frequency ? "is-selected" : ""}><input type="radio" name="frequency" value={frequency} checked={draft.frequency === frequency} onChange={() => change("frequency", frequency)} required /><span>{FREQUENCY_LABELS[frequency]}</span></label>)}</div>
                <FieldError name="frequency" error={errors.frequency} />
              </fieldset>
            </fieldset>

            <div className="filing-optional-heading"><h2>Add useful detail</h2><p>Optional. Include what you know.</p></div>
            {([
              ["Reproduce the issue", ["repro_steps", "expected_behavior", "actual_behavior", "location_quest"]],
              ["Your system and settings", ["hardware_specs", "graphics_mode", "driver_os", "troubleshooting_tried"]],
              ["Evidence and official report", ["evidence_url", "pers_id"]],
            ] as [string, string[]][]).map(([title, names]) => (
              <details className="filing-extra" key={title}>
                <summary>{title}<span aria-hidden="true">+</span></summary>
                <div>
                  {names.map((name) => {
                    const field = DETAIL_FIELDS.find(([fieldName]) => fieldName === name);
                    if (!field) return null;
                    const [fieldName, label, limit, rows] = field;
                    return <TextField key={fieldName} {...fieldProps} name={fieldName} label={label} limit={limit} rows={rows} hint={fieldName === "evidence_url" ? "A screenshot, video, or public post. Use an http:// or https:// link." : undefined} />;
                  })}
                  {names.includes("pers_id") ? <label className="filing-checkbox"><input type="checkbox" name="official_report_submitted" checked={draft.official_report_submitted} onChange={(event) => change("official_report_submitted", event.target.checked)} />I also reported this to Pearl Abyss</label> : null}
                </div>
              </details>
            ))}
            <div className="filing-submit">
              <button type="submit" className="filing-primary">Review report <span aria-hidden="true">→</span></button>
              <p>Review your words before sharing. The hub checks submissions before they contribute to the public record.</p>
            </div>
          </>
        ) : review ? (
          <section className="filing-review" aria-labelledby="review-title">
            <p className="kicker">Review your draft</p>
            <h2 id="review-title" tabIndex={-1} ref={reviewRef}>{review.issue_title}</h2>
            <div className="filing-review-meta"><span>{PLATFORM_LABELS[review.platform]}</span><span>Patch {review.patch_version}</span><span>{CATEGORY_LABELS[review.category]}</span><span>{SEVERITY_LABELS[review.severity][0]}</span><span>{FREQUENCY_LABELS[review.frequency]}</span></div>
            <p className="filing-review-description">{review.description}</p>
            {DETAIL_FIELDS.filter(([name]) => review[name]).map(([name, label]) => <div className="filing-review-detail" key={name}><h3>{label}</h3><p>{review[name]}</p></div>)}
            {review.official_report_submitted ? <p className="filing-review-detail">Also reported to Pearl Abyss.</p> : null}
            {status === "error" && message ? <p className="filing-errors" role="alert">{message}</p> : null}
            <div className="filing-review-actions">
              <button type="button" onClick={() => { setStage("write"); setStatus("idle"); setMessage(""); }}>← Edit draft</button>
              <button type="submit" className="filing-primary" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send report"} <span aria-hidden="true">→</span></button>
            </div>
            <p className="filing-copy-status" role="status">Nothing has been sent until you choose Send report.</p>
          </section>
        ) : null}
        {SITE_KEY ? <ReportCaptcha siteKey={SITE_KEY} /> : null}
      </form>
    </section>
  );
}
