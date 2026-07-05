"use client";

import Script from "next/script";
import { useRef, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FREQUENCIES,
  PATCH_VERSIONS,
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

export default function ReportPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [saveImport, setSaveImport] = useState<SaveImportAnalysis | null>(null);
  const [saveImportMessage, setSaveImportMessage] = useState("");
  const graphicsModeRef = useRef<HTMLTextAreaElement>(null);
  const troubleshootingRef = useRef<HTMLTextAreaElement>(null);

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
    setSaveImport(analysis);
    setSaveImportMessage(`${files.length} local file${files.length === 1 ? "" : "s"} inspected in this browser.`);

    if (analysis.graphicsMode && graphicsModeRef.current && !graphicsModeRef.current.value.trim()) {
      graphicsModeRef.current.value = analysis.graphicsMode;
    }
    if (troubleshootingRef.current && !troubleshootingRef.current.value.includes(analysis.evidenceNote)) {
      troubleshootingRef.current.value = troubleshootingRef.current.value.trim()
        ? `${troubleshootingRef.current.value.trim()}\n\n${analysis.evidenceNote}`
        : analysis.evidenceNote;
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
      <div className="panel mx-auto max-w-xl space-y-3 text-center">
        <p className="stat-label">Report received</p>
        <h1 className="text-2xl font-semibold">Thanks for the clean signal.</h1>
        <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          Your report is in the moderation queue and will appear in the public counts once reviewed.
          If you have crash logs, also file through Pearl Abyss support so engineers get the technical data.
        </p>
        <button className="btn btn-ghost" type="button" onClick={() => setStatus("idle")}>
          Submit another report
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <p className="stat-label">Anonymous structured report</p>
          <h1 className="text-3xl font-semibold tracking-tight">Submit a patch report</h1>
          <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
            No account or email. Reports are reviewed before public counts change. Add hardware and repro detail when you can.
          </p>
        </div>
        <div className="badge badge-crimson">Patch 1.13.00</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr] lg:items-start">
        <section className="panel space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="patch_version">Patch version</label>
              <select id="patch_version" name="patch_version" defaultValue="1.13.00">
                {PATCH_VERSIONS.map((patch) => (
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
              placeholder="FPS drops to about 20 in open-field combat since 1.13"
            />
            {errors.issue_title ? (
              <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>
                {errors.issue_title[0]}
              </p>
            ) : null}
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
            {errors.description ? (
              <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>
                {errors.description[0]}
              </p>
            ) : null}
          </div>
        </section>

        <aside className="panel space-y-4">
          <div className="space-y-2">
            <p className="stat-label">Evidence assistant</p>
            <h2 className="text-lg font-semibold">Use local save/config files</h2>
            <p className="text-sm leading-6" style={{ color: "var(--text-dim)" }}>
              Select the Crimson Desert save folder or the settings XML. The browser reads useful settings locally and
              writes only a sanitized note into the report.
            </p>
          </div>

          <input
            id="save_import"
            type="file"
            multiple
            accept=".xml,.save,.log,.txt"
            onChange={onSaveImport}
            {...DIRECTORY_INPUT_PROPS}
          />
          <p className="text-xs leading-5" style={{ color: "var(--text-faint)" }}>
            Raw files are not uploaded by this helper. It inspects at most {MAX_IMPORT_FILES} selected files and reads only
            small XML/log/text files.
          </p>
          {saveImportMessage ? (
            <p className="badge badge-green" aria-live="polite">
              {saveImportMessage}
            </p>
          ) : null}
          {saveImport ? (
            <div className="space-y-2 border-t pt-3 text-xs leading-5" style={{ borderColor: "var(--border)" }}>
              <p style={{ color: "var(--text-dim)" }}>{saveImport.privacyNote}</p>
              <p style={{ color: "var(--text-faint)" }}>{saveImport.evidenceNote}</p>
            </div>
          ) : null}
        </aside>
      </div>

      <details className="panel group">
        <summary className="cursor-pointer text-sm font-semibold">Add technical detail Pearl Abyss can use</summary>
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
              {errors[field.name] ? (
                <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>
                  {errors[field.name][0]}
                </p>
              ) : null}
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm md:col-span-2" style={{ color: "var(--text-dim)" }}>
            <input type="checkbox" name="official_report_submitted" className="w-auto" />
            I also filed this through Pearl Abyss&apos;s official report tool
          </label>
        </div>
      </details>

      {SITE_KEY ? (
        <>
          <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="dark" />
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
        </>
      ) : null}

      {status === "error" ? (
        <p className="text-sm" style={{ color: "var(--crimson)" }}>
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Submitting..." : "Submit report"}
        </button>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Public pages show approved counts and excerpts only.
        </p>
      </div>
    </form>
  );
}
