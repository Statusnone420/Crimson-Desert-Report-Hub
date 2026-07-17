"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfirmationKind } from "@/lib/confirmations";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/constants";

const KIND_LABELS: Record<ConfirmationKind, string> = {
  have_it: "I have this too",
  still_happening: "Still happening",
  fixed_for_me: "Fixed for me",
};

// localStorage as an external store: hydration-safe (server snapshot is null) and
// same-tab writes notify subscribers, which plain localStorage does not.
const stanceListeners = new Set<() => void>();

function subscribeToStances(listener: () => void): () => void {
  stanceListeners.add(listener);
  return () => stanceListeners.delete(listener);
}

function readStance(key: string): ConfirmationKind | null {
  try {
    const stored = window.localStorage.getItem(key);
    return stored && stored in KIND_LABELS ? (stored as ConfirmationKind) : null;
  } catch {
    return null;
  }
}

function writeStance(key: string, kind: ConfirmationKind): void {
  try {
    window.localStorage.setItem(key, kind);
  } catch {
    // Non-persistent storage: the tap still counted server-side.
  }
  for (const listener of stanceListeners) listener();
}

// Selected stance keeps the semantic ink but stays a rule-bordered text
// button — no pills, no tinted fills, per the Dispatch guardrails.
const KIND_TONES: Record<ConfirmationKind, { color: string; borderColor: string }> = {
  have_it: { color: "var(--blue)", borderColor: "var(--blue)" },
  still_happening: { color: "var(--crimson)", borderColor: "var(--crimson)" },
  fixed_for_me: { color: "var(--green)", borderColor: "var(--green)" },
};

type Phase = "idle" | "picking" | "sending" | "done";

export function ConfirmButtons({
  clusterId,
  storageScope,
  question,
  kinds,
  counts,
}: {
  clusterId: string;
  storageScope: string;
  question: string;
  kinds: ConfirmationKind[];
  counts: Partial<Record<ConfirmationKind, number>>;
}) {
  const storageKey = `cd-confirm-${clusterId}-${storageScope}`;
  const answered = useSyncExternalStore(
    subscribeToStances,
    () => readStance(storageKey),
    () => null,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingKind, setPendingKind] = useState<ConfirmationKind | null>(null);
  const [message, setMessage] = useState("");
  const kindButtons = useRef<Partial<Record<ConfirmationKind, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (phase === "done" && answered) kindButtons.current[answered]?.focus();
  }, [answered, phase]);

  async function submit(platform: string) {
    if (!pendingKind) return;
    setPhase("sending");
    setMessage("");
    try {
      const res = await fetch("/api/confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cluster_id: clusterId, platform, kind: pendingKind }),
      });
      if (res.status === 201) {
        const nextKind = pendingKind;
        setPhase("done");
        setPendingKind(null);
        writeStance(storageKey, nextKind);
        return;
      }
      let errorCode: string | null = null;
      try {
        const payload: unknown = await res.json();
        if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
          errorCode = payload.error;
        }
      } catch {
        // The status code still provides a safe generic fallback.
      }
      setMessage(
        errorCode === "preview_writes_disabled"
          ? "This preview is read-only. Confirmations work on the production site."
          : res.status === 429
          ? "Too many taps from this network — try again later."
          : "Didn't count. Try again.",
      );
      setPhase("picking");
    } catch {
      setMessage("Didn't count. Try again.");
      setPhase("picking");
    }
  }

  function countFor(kind: ConfirmationKind): number {
    return counts[kind] ?? 0;
  }

  const selectedKind = pendingKind ?? answered;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3.5">
        <span style={{ fontSize: 13, color: "var(--dispatch-faint)" }}>{question}</span>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="tap-btn"
            ref={(button) => {
              kindButtons.current[kind] = button;
            }}
            disabled={phase === "sending"}
            aria-pressed={selectedKind === kind}
            aria-label={
              countFor(kind) > 0 ? `${KIND_LABELS[kind]} — ${countFor(kind)} counted so far` : undefined
            }
            style={selectedKind === kind ? KIND_TONES[kind] : undefined}
            onClick={() => {
              setPendingKind(kind);
              setPhase("picking");
              setMessage("");
            }}
          >
            {KIND_LABELS[kind]}
            {countFor(kind) > 0 ? (
              <span aria-hidden="true" className="tap-btn__count">
                {countFor(kind)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {phase === "picking" || phase === "sending" ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pick your platform">
          <span style={{ fontSize: 13, color: "var(--dispatch-faint)" }}>On which platform?</span>
          {PLATFORMS.filter((platform) => platform !== "other").map((platform) => (
            <button
              key={platform}
              type="button"
              className="tap-btn tap-btn--sm"
              disabled={phase === "sending"}
              onClick={() => submit(platform)}
            >
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
          <button
            type="button"
            className="tap-btn tap-btn--sm"
            disabled={phase === "sending"}
            onClick={() => submit("other")}
          >
            Other
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="text-xs" style={{ color: "var(--crimson)" }} role="alert">
          {message}
        </p>
      ) : null}
      {phase === "done" ? (
        <p className="text-xs" style={{ color: "var(--dispatch-faint)" }} role="status" aria-live="polite">
          Recorded once per network per patch. Counts refresh from the server; you can change your answer.
        </p>
      ) : null}
    </div>
  );
}
