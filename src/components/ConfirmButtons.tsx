"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { ConfirmationKind } from "@/lib/confirmations";
import { PLATFORMS, PLATFORM_LABELS } from "@/lib/constants";
import { ReportCaptcha } from "@/components/newspaper/ReportCaptcha";

const KIND_LABELS: Record<ConfirmationKind, string> = {
  have_it: "Happening to me",
  not_happening: "Not happening for me",
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
    return stored && Object.hasOwn(KIND_LABELS, stored) ? (stored as ConfirmationKind) : null;
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

const KIND_ACCENTS: Record<ConfirmationKind, string> = {
  have_it: "var(--blue)",
  not_happening: "var(--muted)",
  still_happening: "var(--red)",
  fixed_for_me: "var(--green)",
};

type Phase = "idle" | "picking" | "sending" | "done";

type ConfirmButtonsProps = {
  clusterId: string;
  storageScope: string;
  question: string;
  kinds: ConfirmationKind[];
  counts: Partial<Record<ConfirmationKind, number>>;
};

export function ConfirmButtons(props: ConfirmButtonsProps) {
  return <ConfirmButtonsFlow key={`${props.clusterId}\u0000${props.storageScope}`} {...props} />;
}

function ConfirmButtonsFlow({
  clusterId,
  storageScope,
  question,
  kinds,
  counts,
}: ConfirmButtonsProps) {
  const storageKey = `cd-checkin-${clusterId}-${storageScope}`;
  const answered = useSyncExternalStore(
    subscribeToStances,
    () => readStance(storageKey),
    () => null,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingKind, setPendingKind] = useState<ConfirmationKind | null>(null);
  const [message, setMessage] = useState("");
  const [selectedPlatform, setPlatform] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const kindButtons = useRef<Partial<Record<ConfirmationKind, HTMLButtonElement | null>>>({});
  const platformButtons = useRef<HTMLButtonElement[]>([]);
  const returnFocusKind = useRef<ConfirmationKind | null>(null);
  const questionId = useId();
  const platformId = useId();
  const selectionId = useId();
  const reducedMotion = useReducedMotion();
  const isCurrent = useRef(true);

  useEffect(() => {
    isCurrent.current = true;
    return () => {
      isCurrent.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase === "picking") {
      platformButtons.current[0]?.focus();
      return;
    }
    const kind = returnFocusKind.current;
    if (kind && phase !== "sending") {
      kindButtons.current[kind]?.focus();
      returnFocusKind.current = null;
    }
  }, [phase]);

  function closePlatformPicker() {
    if (phase === "sending") return;
    if (pendingKind) returnFocusKind.current = pendingKind;
    setPendingKind(null);
    setPlatform(null);
    setToken("");
    setMessage("");
    setPhase(answered ? "done" : "idle");
  }

  function chooseKind(kind: ConfirmationKind) {
    if (phase === "sending") return;
    returnFocusKind.current = kind;
    setPendingKind(kind);
    setPlatform(null);
    setToken("");
    setCaptchaAttempt((attempt) => attempt + 1);
    setMessage("");
    setPhase("picking");
  }

  async function submit() {
    const platform = selectedPlatform;
    if (!pendingKind || !platform || !token || phase === "sending") return;
    const kind = pendingKind;
    const requestStorageKey = storageKey;
    setPhase("sending");
    setMessage("");
    try {
      const res = await fetch("/api/confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cluster_id: clusterId, platform, kind, patch_version: storageScope, turnstile_token: token }),
      });
      if (!isCurrent.current) return;
      if (res.status === 201) {
        setPhase("done");
        setPendingKind(null);
        setToken("");
        writeStance(requestStorageKey, kind);
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
      if (!isCurrent.current) return;
      setMessage(
        errorCode === "preview_writes_disabled"
          ? "This preview is read-only. Check-ins work on the production site."
          : errorCode === "stale_patch"
          ? "A new patch is available. Refresh this page before checking in."
          : errorCode === "checkins_unavailable"
          ? "Check-ins are not available yet. Try again later."
          : errorCode === "claim_context_unavailable"
          ? "The official fix context could not be verified. Your answer was not saved; try again later."
          : errorCode === "claim_required"
          ? "This issue no longer has a verified current-patch fix claim. Refresh the page to see the available responses."
          : errorCode === "turnstile_unavailable"
          ? "Bot protection is unavailable. Your answer could not be saved."
          : errorCode === "captcha_failed"
          ? "The bot check expired or failed. Please verify again."
          : errorCode === "current_patch_unavailable"
          ? "The current patch could not be verified. Try again later."
          : res.status === 429
          ? "Too many taps from this network — try again later."
          : "Saving could not be confirmed. Retry to replace this network’s answer without adding another.",
      );
      setToken("");
      setCaptchaAttempt((attempt) => attempt + 1);
      setPhase("picking");
    } catch {
      if (!isCurrent.current) return;
      setMessage("Saving could not be confirmed. Retry to replace this network’s answer without adding another.");
      setToken("");
      setCaptchaAttempt((attempt) => attempt + 1);
      setPhase("picking");
    }
  }

  function countFor(kind: ConfirmationKind): number {
    return counts[kind] ?? 0;
  }

  const selectedKind = pendingKind ?? answered;

  return (
    <div className="confirmation-checkin">
      <div className="confirmation-checkin__heading"><span id={questionId} className="confirmation-checkin__question">{question}</span><span className="confirmation-checkin__patch">Patch {storageScope}</span></div>
      <div className="confirmation-checkin__row" role="group" aria-labelledby={questionId}>
        {kinds.map((kind) => (
          <motion.button
            key={kind}
            type="button"
            className="tap-btn"
            data-kind={kind}
            ref={(button) => {
              kindButtons.current[kind] = button;
            }}
            disabled={phase === "sending"}
            aria-pressed={selectedKind === kind}
            aria-label={
              countFor(kind) > 0 ? `${KIND_LABELS[kind]} — ${countFor(kind)} counted so far` : undefined
            }
            style={{ "--checkin-accent": KIND_ACCENTS[kind] } as CSSProperties}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            onClick={() => chooseKind(kind)}
          >
            {selectedKind === kind ? (
              <motion.span
                aria-hidden="true"
                className="tap-btn__selection"
                layoutId={`confirmation-checkin-selection-${selectionId}`}
                transition={{ duration: reducedMotion ? 0 : 0.16 }}
              />
            ) : null}
            <span className="tap-btn__label">{KIND_LABELS[kind]}</span>
            <span aria-hidden="true" className="tap-btn__count">{countFor(kind)}</span>
          </motion.button>
        ))}
      </div>
      {phase === "picking" || phase === "sending" ? (
        <motion.div
          className="confirmation-checkin__platforms"
          role="group"
          aria-labelledby={platformId}
          initial={reducedMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && phase !== "sending") {
              event.preventDefault();
              closePlatformPicker();
            }
          }}
        >
          <span id={platformId} className="confirmation-checkin__platform-question">Choose your platform.</span>
          {PLATFORMS.filter((platform) => platform !== "other").map((platform) => (
            <button
              key={platform}
              type="button"
              className="tap-btn tap-btn--sm"
              ref={(button) => {
                if (button) platformButtons.current[PLATFORMS.indexOf(platform)] = button;
              }}
              disabled={phase === "sending"}
              aria-pressed={selectedPlatform === platform}
              onClick={() => setPlatform(platform)}
            >
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
          <button
            type="button"
            className="tap-btn tap-btn--sm"
            ref={(button) => {
              if (button) platformButtons.current[PLATFORMS.length - 1] = button;
            }}
            disabled={phase === "sending"}
            aria-pressed={selectedPlatform === "other"}
            onClick={() => setPlatform("other")}
          >
            Other
          </button>
          <button type="button" className="tap-btn tap-btn--sm confirmation-checkin__cancel" disabled={phase === "sending"} onClick={closePlatformPicker}>
            Cancel
          </button>
          {selectedPlatform ? <div className="confirmation-checkin__verify">
            <p>{PLATFORM_LABELS[selectedPlatform as keyof typeof PLATFORM_LABELS]} · {pendingKind ? KIND_LABELS[pendingKind] : ""}</p>
            {siteKey ? <ReportCaptcha key={captchaAttempt} siteKey={siteKey} onToken={setToken} onError={() => setMessage("The bot check could not load. Check your connection or try again later.")} /> : <p role="alert">Bot protection is unavailable. Check-ins cannot be saved right now.</p>}
            <button className="checkin-save" type="button" disabled={!token || phase === "sending"} onClick={submit}>{phase === "sending" ? "Saving…" : "Save check-in"}<span aria-hidden="true"> →</span></button>
          </div> : null}
        </motion.div>
      ) : null}
      {message ? (
        <p className="confirmation-checkin__status confirmation-checkin__status--error" role="alert">
          {message}
        </p>
      ) : null}
      {phase === "done" ? (
        <p className="confirmation-checkin__status" role="status" aria-live="polite">
          Saved for patch {storageScope}. One answer per network and issue; changing it replaces the previous answer. Totals refresh from the server.
        </p>
      ) : null}
      {(phase === "picking" || phase === "sending") ? (
        <p className="confirmation-checkin__status" role="status" aria-live="polite">
          {phase === "sending" ? "Recording your answer…" : selectedPlatform ? "Complete the bot check, then save your check-in." : "Choose the platform where you play. No account or written report."}
        </p>
      ) : null}
    </div>
  );
}
