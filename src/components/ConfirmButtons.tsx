"use client";

import { useState, useSyncExternalStore } from "react";
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

const KIND_TONES: Record<ConfirmationKind, { color: string; borderColor: string; background: string }> = {
  have_it: { color: "var(--blue)", borderColor: "var(--blue)", background: "var(--blue-tint)" },
  still_happening: { color: "var(--crimson-bright)", borderColor: "var(--crimson-edge)", background: "var(--crimson-tint)" },
  fixed_for_me: { color: "var(--green-bright)", borderColor: "var(--green-edge)", background: "var(--green-tint)" },
};

type Phase = "idle" | "picking" | "sending" | "done";

export function ConfirmButtons({
  clusterId,
  patchFamily,
  question,
  kinds,
  counts,
}: {
  clusterId: string;
  patchFamily: string;
  question: string;
  kinds: ConfirmationKind[];
  counts: Partial<Record<ConfirmationKind, number>>;
}) {
  const storageKey = `cd-confirm-${clusterId}-${patchFamily}`;
  const answered = useSyncExternalStore(
    subscribeToStances,
    () => readStance(storageKey),
    () => null,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingKind, setPendingKind] = useState<ConfirmationKind | null>(null);
  const [bumped, setBumped] = useState<ConfirmationKind | null>(null);
  const [message, setMessage] = useState("");

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
        setBumped(pendingKind);
        setPhase("done");
        writeStance(storageKey, pendingKind);
        return;
      }
      setMessage(
        res.status === 429
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
    return (counts[kind] ?? 0) + (bumped === kind ? 1 : 0);
  }

  if (answered) {
    const tone = KIND_TONES[answered];
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-faint)" }}>
        <span className="chip" style={tone} aria-pressed="true">
          {KIND_LABELS[answered]}
          {countFor(answered) > 0 ? <span className="num">{countFor(answered)}</span> : null}
        </span>
        <span>Counted once per network per patch.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {question}
        </span>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="chip"
            disabled={phase === "sending"}
            aria-pressed={pendingKind === kind}
            style={pendingKind === kind ? KIND_TONES[kind] : undefined}
            onClick={() => {
              setPendingKind(kind);
              setPhase("picking");
              setMessage("");
            }}
          >
            {KIND_LABELS[kind]}
            {countFor(kind) > 0 ? (
              <span className="num" style={{ color: "var(--text-faint)" }}>
                {countFor(kind)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {phase === "picking" || phase === "sending" ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pick your platform">
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            On which platform?
          </span>
          {PLATFORMS.filter((platform) => platform !== "other").map((platform) => (
            <button
              key={platform}
              type="button"
              className="chip"
              disabled={phase === "sending"}
              onClick={() => submit(platform)}
            >
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
          <button type="button" className="chip" disabled={phase === "sending"} onClick={() => submit("other")}>
            Other
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="text-xs" style={{ color: "var(--crimson-bright)" }} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
