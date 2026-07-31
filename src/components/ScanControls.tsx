"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Progress = {
  stage: string;
  searchesDone: number;
  searchTotal: number;
  candidatesSeen: number;
  prefilterRejected: number;
  llmCallsUsed: number;
  kept: number;
  promoted: number;
};

type RunStatus = {
  id: string;
  status: string;
  mode: string;
  progress: Progress | null;
  errors: string[];
};

type ProviderSmokeResult = {
  ok: boolean;
  error?: string;
  model?: string;
  providerRoute?: string;
  llmCallsUsed?: number;
  llmCostUsd?: number;
  fallbackReason?: string;
};

function providerSmokeErrorMessage(result: ProviderSmokeResult): string {
  if (result.error === "provider_smoke_budget_unverified") {
    return "OpenRouter must enforce a monthly key limit of $2 or less before this check can run.";
  }
  if (result.error === "provider_smoke_budget_exhausted") {
    return "The OpenRouter key has less than one safe request ceiling left this month.";
  }
  return `AI route check failed: ${result.fallbackReason ?? result.error ?? "unknown error"}.`;
}

const STAGE_LABELS: Record<string, string> = {
  starting: "Warming up",
  searching: "Searching public sources",
  screening: "Screening candidates",
  persisting: "Saving qualifying leads",
  done: "Finished",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  success: "Scan finished",
  partial: "Scan finished",
  failed: "Scan failed",
  skipped: "Scan skipped",
};

const POLL_MS = 2500;
const MAX_POLL_FAILURES = 4;

export function ScanControls({ activeRunId, isPreview }: { activeRunId: string | null; isPreview: boolean }) {
  const router = useRouter();
  // runId seeds from activeRunId only at mount, by design (post-refresh prop changes must not restart polling).
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<"manual" | "dry_run" | null>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<ProviderSmokeResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let failures = 0;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/scan/status?id=${runId}`, { cache: "no-store" });
        if (res.status === 401) {
          // Admin session expired mid-scan; the scan itself keeps running server-side.
          if (cancelled) return;
          stopPolling();
          setRunId(null);
          setError("Your session expired — sign in again to check the scan.");
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as RunStatus;
        if (cancelled) return;
        failures = 0;
        setRun(data);
        if (data.status !== "running") {
          stopPolling();
          setRunId(null);
          router.refresh();
        }
      } catch {
        // Transient poll failure — keep trying, but not forever: after 4 consecutive
        // failures stop and tell the admin instead of spinning silently.
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          stopPolling();
          setRunId(null);
          setError("Lost contact with the scan — refresh the page to check its status.");
        }
      }
    };
    void poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [runId, router, stopPolling]);

  const start = async (mode: "manual" | "dry_run") => {
    setError(null);
    setStarting(mode);
    try {
      const res = await fetch("/api/admin/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (res.status === 409) {
        setError("A scan is already running — give it a minute.");
        return;
      }
      if (!res.ok || !data.runId) {
        setError(
          data.error === "preview_writes_disabled"
            ? "Scans are disabled on preview deployments."
            : "Could not start the scan. Try again.",
        );
        return;
      }
      setRun(null);
      setRunId(data.runId);
    } catch {
      setError("Could not reach the scan API. Check your connection and try again.");
    } finally {
      setStarting(null);
    }
  };

  const testProviderRoute = async () => {
    setError(null);
    setSmokeResult(null);
    setSmokeRunning(true);
    try {
      const res = await fetch("/api/admin/scan/provider-smoke", { method: "POST" });
      const data = (await res.json()) as ProviderSmokeResult;
      setSmokeResult(data);
      if (!res.ok || !data.ok) setError(providerSmokeErrorMessage(data));
    } catch {
      setError("Could not reach the AI route check. Try again.");
    } finally {
      setSmokeRunning(false);
    }
  };

  const scanning = runId !== null;
  const progress = run?.progress ?? null;
  const finished = run !== null && run.status !== "running";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {isPreview ? (
          <button
            type="button"
            className="dispatch-btn dispatch-btn--secondary"
            disabled={smokeRunning || scanning || starting !== null}
            onClick={testProviderRoute}
          >
            {smokeRunning ? "Testing AI route…" : "Test AI provider route"}
          </button>
        ) : null}
        <button
          type="button"
          className="dispatch-btn dispatch-btn--secondary"
          disabled={isPreview || scanning || starting !== null || smokeRunning}
          onClick={() => start("dry_run")}
        >
          {starting === "dry_run" ? "Starting…" : "Test scan without publishing"}
        </button>
        <button
          type="button"
          className="dispatch-btn"
          disabled={isPreview || scanning || starting !== null || smokeRunning}
          onClick={() => start("manual")}
        >
          {starting === "manual" ? "Starting…" : "Run capped scan now"}
        </button>
      </div>

      {isPreview ? (
        <p className="text-xs" style={{ color: "var(--dispatch-faint)" }}>
          Preview keeps full scans disabled. The provider check uses synthetic text, one AI call, and no database writes.
        </p>
      ) : null}

      {smokeResult?.ok ? (
        <p className="text-xs" style={{ color: "var(--green)" }} role="status">
          AI route verified · {smokeResult.model} through {smokeResult.providerRoute} · {"$"}
          {(smokeResult.llmCostUsd ?? 0).toFixed(6)}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs" style={{ color: "var(--crimson)" }} role="alert">
          {error}
        </p>
      ) : null}

      {scanning || finished ? (
        <div className="fade-rise dispatch-inset-box" style={{ padding: "12px 16px", flexDirection: "column", alignItems: "stretch", gap: 8 }} aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: finished ? (run?.status === "failed" ? "var(--crimson)" : "var(--green)") : "var(--amber)",
              }}
            >
              ●{" "}
              {finished
                ? (RUN_STATUS_LABELS[run?.status ?? ""] ?? "Scan finished")
                : (STAGE_LABELS[progress?.stage ?? "starting"] ?? "Scanning")}
            </span>
            {!finished ? (
              <span className="text-xs" style={{ color: "var(--dispatch-faint)" }}>
                Updates live while the scan runs.
              </span>
            ) : null}
          </div>
          {progress ? (
            <p className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--dispatch-dim)" }}>
              {progress.searchesDone}/{progress.searchTotal} searches · {progress.candidatesSeen} candidates ·{" "}
              {progress.prefilterRejected} pre-filtered · {progress.llmCallsUsed} LLM · {progress.kept} kept ·{" "}
              {progress.promoted} promoted
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--dispatch-faint)" }}>
              Starting the pipeline…
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
