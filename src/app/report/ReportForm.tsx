"use client";

import Link from "next/link";
import Script from "next/script";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";
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

// Viewport as an external store: below 900px the assistant rail starts
// collapsed behind its disclosure; the desktop rail renders expanded.
const MOBILE_QUERY = "(max-width: 899px)";

function subscribeToViewport(listener: () => void): () => void {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }} role="alert">
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
  // Desktop shows the assistant rail expanded; below 900px it starts collapsed
  // behind the disclosure summary. A user toggle wins over the derived default.
  const [assistantToggled, setAssistantToggled] = useState<boolean | null>(null);
  const mobileViewport = useSyncExternalStore(subscribeToViewport, isMobileViewport, () => false);
  const assistantOpen = assistantToggled ?? !mobileViewport;
  const graphicsModeRef = useRef<HTMLTextAreaElement>(null);
  const troubleshootingRef = useRef<HTMLTextAreaElement>(null);
  const saveImportFileInputRef = useRef<HTMLInputElement>(null);
  const saveImportFolderInputRef = useRef<HTMLInputElement>(null);

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
    if (saveImportFileInputRef.current) {
      saveImportFileInputRef.current.value = "";
    }
    if (saveImportFolderInputRef.current) {
      saveImportFolderInputRef.current.value = "";
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
      <div className="report-success">
        <p className="report-success__mark">✓ Report received</p>
        <h1 className="report-success__title">Filed.</h1>
        <p className="report-success__copy">
          It&rsquo;s checked and sorted into the right issue automatically — no queue, no waiting. Your raw words
          stay private; only counts and a neutral summary ever go public. Crash logs? File through Pearl Abyss
          support too.
        </p>
        <div className="report-success__actions">
          <button className="dispatch-btn dispatch-btn--secondary" type="button" onClick={() => setStatus("idle")}>
            File another report
          </button>
          <Link href="/issues" className="dispatch-link" style={{ fontSize: 13.5 }}>
            See the Issue Board →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <header className="dispatch-pagehead">
        <div className="dispatch-pagehead__copy">
          <p className="dispatch-kicker">Anonymous structured report</p>
          <h1 className="dispatch-pagehead__title">File a report</h1>
          <p className="dispatch-pagehead__dek">
            No account, no email. Your report helps separate isolated bugs from patch-wide patterns. Add only what
            you know; the board sorts it into public issue counts after checks.
          </p>
        </div>
        <div className="dispatch-pagehead__status">
          FILING AGAINST{" "}
          <a
            href={currentPatch.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="dispatch-link"
            aria-label={`Open official Patch ${currentPatch.version} notes`}
          >
            PATCH {currentPatch.version} ↗
          </a>
        </div>
      </header>

      <div className="report-grid">
        <div className="report-form-col">
          <div className="report-section-label">The basics</div>
          <div className="report-row-3">
            <div className="dispatch-field">
              <label htmlFor="patch_version">Patch you&apos;re playing on</label>
              <select id="patch_version" name="patch_version" defaultValue={currentPatch.version}>
                {patchVersions.map((patch) => (
                  <option key={patch} value={patch}>
                    {patch === "other" ? "Other" : patch}
                  </option>
                ))}
              </select>
            </div>
            <div className="dispatch-field">
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
            <div className="dispatch-field">
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
          </div>
          <div className="report-row-3">
            <div className="dispatch-field">
              <label htmlFor="severity">Severity</label>
              <select id="severity" name="severity" required defaultValue="medium">
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </select>
            </div>
            <div className="dispatch-field">
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

          <div className="dispatch-field">
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

          <div className="dispatch-field">
            <label htmlFor="description">What happened?</label>
            <textarea
              id="description"
              name="description"
              required
              minLength={20}
              maxLength={4000}
              rows={4}
              placeholder="Describe the problem in your own words — raw text stays private."
            />
            <FieldError messages={errors.description} />
          </div>

          <div className="report-section-rule">
            <div className="report-section-label">Technical detail Pearl Abyss can use</div>
            <div className="report-section-rule__note">optional · stronger evidence</div>
          </div>

          <div className="dispatch-field">
            <label htmlFor="repro_steps">Steps to reproduce</label>
            <textarea
              id="repro_steps"
              name="repro_steps"
              rows={3}
              placeholder={"1. Open world map during combat\n2. ..."}
            />
            <FieldError messages={errors.repro_steps} />
          </div>
          <div className="report-row-2">
            <div className="dispatch-field">
              <label htmlFor="expected_behavior">Expected behavior</label>
              <input id="expected_behavior" name="expected_behavior" />
              <FieldError messages={errors.expected_behavior} />
            </div>
            <div className="dispatch-field">
              <label htmlFor="actual_behavior">Actual behavior</label>
              <input id="actual_behavior" name="actual_behavior" />
              <FieldError messages={errors.actual_behavior} />
            </div>
          </div>
          <div className="report-row-2">
            <div className="dispatch-field">
              <label htmlFor="location_quest">Location / quest</label>
              <input id="location_quest" name="location_quest" />
              <FieldError messages={errors.location_quest} />
            </div>
            <div className="dispatch-field">
              <label htmlFor="hardware_specs">Hardware (GPU, CPU, RAM)</label>
              <input id="hardware_specs" name="hardware_specs" placeholder="RTX 4060 8GB, i5-13600K, 32GB" />
              <FieldError messages={errors.hardware_specs} />
            </div>
          </div>
          <div className="report-row-2">
            <div className="dispatch-field">
              <label htmlFor="graphics_mode">Graphics mode / FPS setting</label>
              <textarea
                id="graphics_mode"
                name="graphics_mode"
                rows={2}
                placeholder="Performance mode / FSR on"
                ref={graphicsModeRef}
              />
              <FieldError messages={errors.graphics_mode} />
            </div>
            <div className="dispatch-field">
              <label htmlFor="driver_os">Driver / OS version</label>
              <input id="driver_os" name="driver_os" placeholder="NVIDIA 566.14, Windows 11 24H2" />
              <FieldError messages={errors.driver_os} />
            </div>
          </div>
          <div className="dispatch-field">
            <label htmlFor="troubleshooting_tried">Troubleshooting you tried</label>
            <textarea id="troubleshooting_tried" name="troubleshooting_tried" rows={3} ref={troubleshootingRef} />
            <FieldError messages={errors.troubleshooting_tried} />
          </div>
          <div className="report-row-2">
            <div className="dispatch-field">
              <label htmlFor="pers_id">Pearl Abyss PERS ID (if you filed one)</label>
              <input id="pers_id" name="pers_id" />
              <FieldError messages={errors.pers_id} />
            </div>
            <div className="dispatch-field">
              <label htmlFor="evidence_url">Evidence link (YouTube, Reddit, X, etc.)</label>
              <input id="evidence_url" name="evidence_url" placeholder="https://..." />
              <FieldError messages={errors.evidence_url} />
            </div>
          </div>

          <label className="report-check">
            <input type="checkbox" name="official_report_submitted" className="w-auto" />
            I also filed this through Pearl Abyss&apos;s official report tool
          </label>

          {status === "error" ? (
            <p className="text-sm" style={{ color: "var(--crimson)" }} role="alert">
              {message}
            </p>
          ) : null}

          <div className="report-submit-row">
            <button className="dispatch-btn" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Submitting…" : "Submit report"}
            </button>
            <p className="report-submit-row__caption">Public pages show sorted counts and neutral summaries only.</p>
          </div>
        </div>

        <details
          className="assistant-rail"
          open={assistantOpen}
          onToggle={(event) => setAssistantToggled((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span>Auto-fill from local PC files</span>
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="assistant-rail__header">Evidence assistant</div>
          <div className="assistant-rail__block">
            <div className="assistant-rail__title">Auto-fill from local PC files</div>
            <p className="assistant-rail__copy">
              Your browser cannot scan your PC. It can only read files or folders you choose here. Raw files are
              not uploaded; you review the generated note before it touches your report.
            </p>
          </div>
          <div className="assistant-rail__block">
            <div className="assistant-rail__title assistant-rail__title--sm">Best file to choose</div>
            <p className="assistant-rail__copy">
              <span className="mono-ink">user_engine_option_save.xml</span> can fill graphics settings like upscale
              mode, frame generation, VSync, and HDR.
            </p>
            <div className="assistant-rail__buttons">
              <button
                type="button"
                className="tap-btn"
                onClick={() => saveImportFileInputRef.current?.click()}
              >
                Choose settings file
              </button>
              <button
                type="button"
                className="tap-btn"
                onClick={() => saveImportFolderInputRef.current?.click()}
              >
                Choose folder
              </button>
            </div>
            <p className="assistant-rail__status" aria-live="polite">
              {saveImportMessage || "Nothing selected yet"}
            </p>
            <input
              id="save_import"
              type="file"
              multiple
              accept=".xml,.save,.log,.txt"
              onChange={onSaveImport}
              ref={saveImportFileInputRef}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              id="save_import_folder"
              type="file"
              multiple
              accept=".xml,.save,.log,.txt"
              onChange={onSaveImport}
              ref={saveImportFolderInputRef}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              {...DIRECTORY_INPUT_PROPS}
            />
          </div>
          <div className="assistant-rail__block">
            <div className="assistant-rail__title assistant-rail__title--sm">Find it on Windows</div>
            <ol className="assistant-rail__copy" style={{ display: "grid", gap: 4 }}>
              <li>1. Open File Explorer and search This PC for user_engine_option_save.xml.</li>
              <li>2. Right-click the result and choose Open file location.</li>
              <li>3. Select that file here, or select the folder that contains it.</li>
              <li>4. If search finds nothing, skip this helper.</li>
            </ol>
            <p className="assistant-rail__copy" style={{ marginTop: 8 }}>
              Inspects at most {MAX_IMPORT_FILES} selected files, reads only small XML/log/text files.
            </p>
          </div>
          {pendingImport ? (
            <div className="assistant-rail__block">
              <div className="report-section-label">Preview — nothing added yet</div>
              <div className="assistant-rail__preview">{pendingImport.evidenceNote}</div>
              {pendingImport.graphicsMode ? (
                <div className="assistant-rail__preview">{pendingImport.graphicsMode}</div>
              ) : null}
              <div className="assistant-rail__buttons">
                <button className="dispatch-btn" type="button" onClick={onAddSaveImport}>
                  Add to report
                </button>
                <button className="tap-btn" type="button" onClick={onDiscardSaveImport}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}
          <div className="assistant-rail__block">
            <p className="assistant-rail__copy">Only the sanitized summary can be included with the report.</p>
            {saveImport ? (
              <>
                <p className="assistant-rail__copy" style={{ marginTop: 8 }}>
                  {saveImport.privacyNote}
                </p>
                <p className="assistant-rail__copy" style={{ marginTop: 8 }}>
                  {saveImport.evidenceNote}
                </p>
                <p className="assistant-rail__confirm">✓ Added to Troubleshooting field</p>
              </>
            ) : null}
          </div>
          <div className="assistant-rail__next">
            <span className="report-section-label">What happens next</span>
            <p className="assistant-rail__copy">
              Checked and sorted into the right issue automatically. Raw words stay private — only counts and a
              neutral summary go public. Duplicates merge, so one real patch problem reads as one moderated issue
              cluster.
            </p>
          </div>
        </details>
      </div>

      {SITE_KEY ? (
        <>
          <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="dark" />
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="lazyOnload" />
        </>
      ) : null}
    </form>
  );
}
