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

const STAGE_LABELS: Record<string, string> = {
  starting: "Warming up",
  searching: "Searching public sources",
  screening: "Screening candidates",
  persisting: "Saving qualifying signals",
  done: "Finished",
};

const POLL_MS = 2500;

export function ScanControls({ activeRunId }: { activeRunId: string | null }) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<"manual" | "dry_run" | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/scan/status?id=${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as RunStatus;
        if (cancelled) return;
        setRun(data);
        if (data.status !== "running") {
          stopPolling();
          setRunId(null);
          router.refresh();
        }
      } catch {
        // transient poll failure — keep trying; the server-side stale sweep guards the terminal case
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

  const scanning = runId !== null;
  const progress = run?.progress ?? null;
  const finished = run !== null && run.status !== "running";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={scanning || starting !== null}
          onClick={() => start("dry_run")}
        >
          {starting === "dry_run" ? "Starting…" : "Test scan without publishing"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={scanning || starting !== null}
          onClick={() => start("manual")}
        >
          {starting === "manual" ? "Starting…" : "Run capped scan now"}
        </button>
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--crimson-bright)" }}>
          {error}
        </p>
      ) : null}

      {scanning || finished ? (
        <div className="panel-inset space-y-2 border p-3 text-sm" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className={finished ? "badge badge-green badge-dot" : "badge badge-amber badge-dot"}>
              {finished ? `scan ${run?.status}` : (STAGE_LABELS[progress?.stage ?? "starting"] ?? "Scanning")}
            </span>
            {!finished ? (
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                the site stays usable — this card updates itself
              </span>
            ) : null}
          </div>
          {progress ? (
            <p className="num text-xs" style={{ color: "var(--text-dim)" }}>
              {progress.searchesDone}/{progress.searchTotal} searches · {progress.candidatesSeen} candidates ·{" "}
              {progress.prefilterRejected} pre-filtered · {progress.llmCallsUsed} LLM · {progress.kept} kept ·{" "}
              {progress.promoted} promoted
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Starting the pipeline…
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
