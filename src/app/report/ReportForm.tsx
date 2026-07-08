"use client";

import Script from "next/script";
import { useRef, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FREQUENCIES,
  PLATFORMS,
  PLATFORM_LABELS,
  SEVERITIES,
} from "@/lib/constants";
import { analyzeSaveImport, type SaveImportAnalysis, type SaveImportFile } from "@/lib/saveImport";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const MAX_IMPORT_FILES = 18;
const MAX_TEXT_FILE_BYTES = 250_000;

const OPTIONAL_FIELDS: { name: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { name: "repro_steps", label: "Steps to reproduce", textarea: true, placeholder: "1. Open world map during combat\n2. ..." },
  { name: "expected_behavior", label: "Expected behavior" },
  { name: "actual_behavior", label: "Actual behavior" },
  { name: "location_quest", label: "Location / quest" },
  { name: "hardware_specs", label: "Hardware (GPU, CPU, RAM)", placeholder: "RTX 4060 8GB, i5-13600K, 32GB" },
  { name: "graphics_mode", label: "Graphics mode / FPS setting", textarea: true, placeholder: "Performance mode / FSR on" },
  { name: "driver_os", label: "Driver / OS version", placeholder: "NVIDIA 566.14, Windows 11 24H2" },
  { name: "troubleshooting_tried", label: "Troubleshooting you tried", textarea: true },
  { name: "pers_id", label: "Pearl Abyss PERS ID (if you filed one)" },
  { name: "evidence_url", label: "Evidence link (YouTube, Reddit, X, etc.)", placeholder: "https://..." },
];

const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  blocking: "Blocking",
};

const FREQUENCY_LABELS: Record<(typeof FREQUENCIES)[number], string> = {
  once: "Once",
  sometimes: "Sometimes",
  often: "Often",
  always: "Always",
};

const DIRECTORY_INPUT_PROPS: InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
} = {
  webkitdirectory: "",
  directory: "",
};

type ReportPatchMetadata = {
  version: string;
  title: string;
  officialUrl: string;
};

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--crimson-bright)" }}>
      {messages[0]}
    </p>
  );
}

export function ReportForm({
  currentPatch,
  patchVersions,
}: {
  currentPatch: ReportPatchMetadata;
  patchVersions: string[];
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [saveImport, setSaveImport] = useState<SaveImportAnalysis | null>(null);
  const [pendingImport, setPendingImport] = useState<SaveImportAnalysis | null>(null);
  const [saveImportMessage, setSaveImportMessage] = useState("");
  const graphicsModeRef = useRef<HTMLTextAreaElement>(null);
  const troubleshootingRef = useRef<HTMLTextAreaElement>(null);
  const saveImportInputRef = useRef<HTMLInputElement>(null);

  async function onSaveImport(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []).slice(0, MAX_IMPORT_FILES);
    if (selectedFiles.length === 0) return;

    setSaveImportMessage("Reading selected files locally...");
    const files: SaveImportFile[] = await Promise.all(
      selectedFiles.map(async (file) => {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const shouldReadText = /\.(xml|log|txt)$/i.test(file.name) && file.size <= MAX_TEXT_FILE_BYTES;
        const text = shouldReadText ? await file.text().catch(() => "") : "";

        return {
          name: file.name,
          relativePath,
          size: file.size,
          lastModified: file.lastModified,
          text,
        };
      }),
    );
    const analysis = analyzeSaveImport(files);
    setPendingImport(analysis);
    setSaveImportMessage(`${files.length} local file${files.length === 1 ? "" : "s"} inspected in this browser.`);
  }

  function onAddSaveImport() {
    if (!pendingImport) return;

    if (pendingImport.graphicsMode && graphicsModeRef.current && !graphicsModeRef.current.value.trim()) {
      graphicsModeRef.current.value = pendingImport.graphicsMode;
    }
    if (troubleshootingRef.current && !troubleshootingRef.current.value.includes(pendingImport.evidenceNote)) {
      troubleshootingRef.current.value = troubleshootingRef.current.value.trim()
        ? `${troubleshootingRef.current.value.trim()}\n\n${pendingImport.evidenceNote}`
        : pendingImport.evidenceNote;
    }

    setSaveImport(pendingImport);
    setPendingImport(null);
  }

  function onDiscardSaveImport() {
    setPendingImport(null);
    setSaveImportMessage("");
    if (saveImportInputRef.current) {
      saveImportInputRef.current.value = "";
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrors({});
    setMessage("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload: Record<string, unknown> = {};

    formData.forEach((value, key) => {
      if (key === "cf-turnstile-response") payload.turnstile_token = String(value);
      else payload[key] = String(value);
    });
    payload.official_report_submitted = formData.get("official_report_submitted") === "on";

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 201) {
      setStatus("done");
      form.reset();
      return;
    }

    const data = await res.json().catch(() => ({}));
    setErrors(data.issues ?? {});
    setMessage(
      res.status === 429
        ? "Rate limit reached. The limit is 5 reports per hour from the same network."
        : res.status === 403
          ? "Spam check failed. Refresh the page and try again."
          : "Something in the form needs fixing. Check the fields above.",
    );
    setStatus("error");
  }

  if (status === "done") {
    return (
      <div className="mx-auto max-w-xl">
        <div className="panel space-y-4 py-10 text-center">
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--green-tint)", border: "1px solid var(--green-edge)" }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="var(--green-bright)" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="space-y-1.5">
            <h1 className="h-display">Report received</h1>
            <p className="mx-auto max-w-md text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              It&rsquo;s checked and sorted into the right issue automatically &mdash; no queue, no waiting. Your raw words
              stay private; only counts and a neutral summary ever go public. Crash logs? File through Pearl Abyss support
              too.
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={() => setStatus("idle")}>
            Submit another report
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="stat-label">Anonymous structured report</div>
          <h1 className="h-display">Add to the evidence board</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            No account, no email. Reports are checked and sorted automatically so the board can show how widespread a
            patch problem is. The more detail you add, the stronger the public signal becomes.
          </p>
        </div>
        <a
          href={currentPatch.officialUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="badge badge-crimson"
          aria-label={`Open official Patch ${currentPatch.version} notes`}
        >
          Patch {currentPatch.version}
        </a>
      </section>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_0.85fr] lg:items-start">
        <section className="panel space-y-5">
          <div className="stat-label">The basics</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="patch_version">Patch version</label>
              <select id="patch_version" name="patch_version" defaultValue={currentPatch.version}>
                {patchVersions.map((patch) => (
                  <option key={patch} value={patch}>
                    {patch === "other" ? "Other" : patch}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="platform">Platform</label>
              <select id="platform" name="platform" required defaultValue="">
                <option value="" disabled>
                  Choose platform
                </option>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {PLATFORM_LABELS[platform]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="category">Category</label>
              <select id="category" name="category" required defaultValue="">
                <option value="" disabled>
                  Choose category
                </option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="severity">Severity</label>
              <select id="severity" name="severity" required defaultValue="medium">
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="frequency">How often?</label>
              <select id="frequency" name="frequency" required defaultValue="sometimes">
                {FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {FREQUENCY_LABELS[frequency]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="issue_title">One-line summary</label>
            <input
              id="issue_title"
              name="issue_title"
              required
              minLength={5}
              maxLength={120}
              placeholder="FPS drops to ~20 in open-field combat since 1.13"
            />
            <FieldError messages={errors.issue_title} />
          </div>

          <div>
            <label htmlFor="description">What happened?</label>
            <textarea
              id="description"
              name="description"
              required
              minLength={20}
              maxLength={4000}
              rows={6}
              placeholder="What were you doing, what went wrong, and how does it compare to before the patch?"
            />
            <FieldError messages={errors.description} />
          </div>

          <details className="panel-inset group border px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
              <span>Add technical detail Pearl Abyss can use</span>
              <span className="text-xs font-normal" style={{ color: "var(--text-faint)" }}>
                optional · stronger evidence
              </span>
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {OPTIONAL_FIELDS.map((field) => (
                <div key={field.name} className={field.textarea ? "md:col-span-2" : undefined}>
                  <label htmlFor={field.name}>{field.label}</label>
                  {field.textarea ? (
                    <textarea
                      id={field.name}
                      name={field.name}
                      rows={field.name === "troubleshooting_tried" ? 4 : 3}
                      placeholder={field.placeholder}
                      ref={
                        field.name === "troubleshooting_tried"
                          ? troubleshootingRef
                          : field.name === "graphics_mode"
                            ? graphicsModeRef
                            : undefined
                      }
                    />
                  ) : (
                    <input id={field.name} name={field.name} placeholder={field.placeholder} />
                  )}
                  <FieldError messages={errors[field.name]} />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm md:col-span-2" style={{ color: "var(--text-dim)" }}>
                <input type="checkbox" name="official_report_submitted" className="w-auto" />
                I also filed this through Pearl Abyss&apos;s official report tool
              </label>
            </div>
          </details>
        </section>

        <aside className="space-y-3">
          <div className="panel space-y-3">
            <div className="stat-label">Evidence assistant</div>
            <h2 className="text-base font-semibold">Use local save / config files</h2>
            <ol className="space-y-1 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              <li>
                1. Pick your settings/log files &mdash; on PC look in Documents\Crimson Desert\ (the settings file is
                user_engine_option_save.xml). Console players: skip this, it&rsquo;s PC-only.
              </li>
              <li>2. Your browser reads them locally and drafts one short note (GPU settings, file names &mdash; no personal data).</li>
              <li>3. You preview the note before it touches your report. Nothing uploads until you press Submit, and only the note is sent.</li>
            </ol>
            <input
              id="save_import"
              type="file"
              multiple
              accept=".xml,.save,.log,.txt"
              onChange={onSaveImport}
              ref={saveImportInputRef}
              {...DIRECTORY_INPUT_PROPS}
            />
            <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
              Inspects at most {MAX_IMPORT_FILES} selected files, reads only small XML/log/text files.
            </p>
            {saveImportMessage ? (
              <p className="badge badge-green" aria-live="polite">
                {saveImportMessage}
              </p>
            ) : null}
            {pendingImport ? (
              <div className="space-y-2 border-t pt-3">
                <div className="stat-label">Preview &mdash; nothing added yet</div>
                <div className="panel-inset border p-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                  {pendingImport.evidenceNote}
                </div>
                {pendingImport.graphicsMode ? (
                  <div className="panel-inset border p-2 text-xs leading-5" style={{ color: "var(--text-faint)" }}>
                    {pendingImport.graphicsMode}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-sm" type="button" onClick={onAddSaveImport}>
                    Add to report
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={onDiscardSaveImport}>
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
            {saveImport ? (
              <div className="space-y-2 border-t pt-3 text-xs leading-5">
                <p style={{ color: "var(--text-dim)" }}>{saveImport.privacyNote}</p>
                <p style={{ color: "var(--text-faint)" }}>{saveImport.evidenceNote}</p>
                <span className="badge badge-green">added to Troubleshooting field</span>
              </div>
            ) : null}
          </div>

          <div className="panel space-y-2">
            <div className="stat-label">What happens next</div>
            <ul className="space-y-2 text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              <li>Checked and sorted into the right issue automatically.</li>
              <li>Your raw words stay private. Only counts and a neutral summary go public.</li>
              <li>Duplicates merge, so one real patch problem reads as one stronger evidence signal.</li>
            </ul>
          </div>
        </aside>
      </div>

      {SITE_KEY ? (
        <>
          <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="dark" />
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
        </>
      ) : null}

      {status === "error" ? (
        <p className="text-sm" style={{ color: "var(--crimson-bright)" }} role="alert">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Submitting…" : "Submit report"}
        </button>
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Public pages show sorted counts and neutral summaries only.
        </p>
      </div>
    </form>
  );
}
