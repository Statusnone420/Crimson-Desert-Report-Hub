"use client";

import { useEffect, useState } from "react";
import type { ConfirmationKind } from "@/lib/confirmations";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/constants";

const KIND_LABELS: Record<ConfirmationKind, string> = {
  have_it: "I have this too",
  still_happening: "Still happening",
  fixed_for_me: "Fixed for me",
};

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [answered, setAnswered] = useState<ConfirmationKind | null>(null);
  const [pendingKind, setPendingKind] = useState<ConfirmationKind | null>(null);
  const [bumped, setBumped] = useState<ConfirmationKind | null>(null);
  const [message, setMessage] = useState("");

  // Read the stored stance after mount so server and first client render match.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey) as ConfirmationKind | null;
      if (stored && stored in KIND_LABELS) {
        setAnswered(stored);
        setPhase("done");
      }
    } catch {
      // Private-mode storage failures just mean the answered state won't persist.
    }
  }, [storageKey]);

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
        setAnswered(pendingKind);
        setBumped(pendingKind);
        setPhase("done");
        try {
          window.localStorage.setItem(storageKey, pendingKind);
        } catch {
          // Non-persistent storage: the tap still counted server-side.
        }
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

  if (phase === "done" && answered) {
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
