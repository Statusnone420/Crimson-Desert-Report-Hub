"use client";

import Script from "next/script";
import { useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FREQUENCIES,
  PATCH_VERSIONS,
  PLATFORMS,
  PLATFORM_LABELS,
  SEVERITIES,
} from "@/lib/constants";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const OPTIONAL_FIELDS: { name: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { name: "repro_steps", label: "Steps to reproduce", textarea: true, placeholder: "1. Open world map during combat\n2. ..." },
  { name: "expected_behavior", label: "Expected behavior" },
  { name: "actual_behavior", label: "Actual behavior" },
  { name: "location_quest", label: "Location / quest" },
  { name: "hardware_specs", label: "Hardware (GPU, CPU, RAM)", placeholder: "RTX 4060 8GB, i5-13600K, 32GB" },
  { name: "graphics_mode", label: "Graphics mode / FPS setting", placeholder: "Performance mode / FSR on" },
  { name: "driver_os", label: "Driver / OS version", placeholder: "NVIDIA 566.14, Windows 11 24H2" },
  { name: "troubleshooting_tried", label: "Troubleshooting you tried", textarea: true },
  { name: "pers_id", label: "Pearl Abyss PERS ID (if you filed one)" },
  { name: "evidence_url", label: "Evidence link (YouTube, Reddit, X, etc.)", placeholder: "https://..." },
];

export default function ReportPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
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
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-5">
      <section className="space-y-2">
        <p className="stat-label">Anonymous structured report</p>
        <h1 className="text-3xl font-semibold tracking-tight">Submit a patch report</h1>
        <p className="max-w-2xl text-sm leading-6" style={{ color: "var(--text-dim)" }}>
          No account or email. Reports are reviewed before public counts change. Add hardware and repro detail when you can.
        </p>
      </section>

      <section className="panel space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="patch_version">Patch version</label>
            <select id="patch_version" name="patch_version" defaultValue="1.13.00">
              {PATCH_VERSIONS.map((patch) => (
                <option key={patch} value={patch}>
                  {patch}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="platform">Platform</label>
            <select id="platform" name="platform" required defaultValue="">
              <option value="" disabled>
                Select...
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
                Select...
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
                  {severity}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="frequency">How often?</label>
            <select id="frequency" name="frequency" required defaultValue="sometimes">
              {FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {frequency}
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
            rows={5}
            placeholder="What were you doing, what went wrong, and how does it compare to before the patch?"
          />
          {errors.description ? (
            <p className="mt-1 text-xs" style={{ color: "var(--crimson)" }}>
              {errors.description[0]}
            </p>
          ) : null}
        </div>
      </section>

      <details className="panel group">
        <summary className="cursor-pointer text-sm font-semibold">Add detail Pearl Abyss can use</summary>
        <div className="mt-4 space-y-3">
          {OPTIONAL_FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={field.name}>{field.label}</label>
              {field.textarea ? (
                <textarea id={field.name} name={field.name} rows={3} placeholder={field.placeholder} />
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
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
            <input type="checkbox" name="official_report_submitted" className="w-auto" />
            I also filed this through Pearl Abyss's official report tool
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
