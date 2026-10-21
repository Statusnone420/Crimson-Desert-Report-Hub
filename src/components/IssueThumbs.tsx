"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ReportCaptcha } from "@/components/newspaper/ReportCaptcha";
import { THUMB_DIRECTIONS, type ThumbDirection } from "@/lib/thumbs";

type Choice = ThumbDirection | "none";

const LABELS: Record<ThumbDirection, string> = {
  up: "Happening to me",
  down: "Not happening for me",
};

// A thumb on a 24-unit grid. The strip left of x = 7 is the cuff.
const HAND = "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z";

/** An outlined thumb that fills with ink when chosen. The down thumb is the same drawing turned over. */
function ThumbGlyph({ direction, gapId }: { direction: ThumbDirection; gapId: string }) {
  return (
    <svg className="issue-thumbs__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        {/* Keeps the cuff apart from the hand once the thumb is filled. */}
        <mask id={gapId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d="M7 8v16" stroke="#000" strokeWidth="1.75" />
        </mask>
      </defs>
      <g transform={direction === "down" ? "rotate(180 12 12)" : undefined}>
        <path className="issue-thumbs__ink" d={HAND} mask={`url(#${gapId})`} />
        <g className="issue-thumbs__outline">
          <path d={HAND} />
          <path d="M7 10v12" />
        </g>
      </g>
    </svg>
  );
}

// localStorage as an external store: hydration-safe (the server snapshot is
// null) and same-tab writes notify subscribers, which plain localStorage does not.
const thumbListeners = new Set<() => void>();

function subscribeToThumbs(listener: () => void): () => void {
  thumbListeners.add(listener);
  return () => thumbListeners.delete(listener);
}

function thumbKey(clusterId: string, patchVersion: string): string {
  return `cd-thumb-${clusterId}-${patchVersion}`;
}

function readThumb(clusterId: string, patchVersion: string): ThumbDirection | null {
  try {
    const saved = window.localStorage.getItem(thumbKey(clusterId, patchVersion));
    if (saved === "up" || saved === "down") return saved;
    if (saved === "none") return null;
    // Before thumbs this device saved the same answer as a check-in.
    const earlier = window.localStorage.getItem(`cd-checkin-${clusterId}-${patchVersion}`);
    return earlier === "have_it" ? "up" : earlier === "not_happening" ? "down" : null;
  } catch {
    return null;
  }
}

function writeThumb(clusterId: string, patchVersion: string, choice: Choice): void {
  try {
    window.localStorage.setItem(thumbKey(clusterId, patchVersion), choice);
  } catch {
    // Storage is blocked: the server kept the tap, this device cannot show it later.
  }
  for (const listener of thumbListeners) listener();
}

function failureText(code: string | null, status: number): string {
  if (code === "preview_writes_disabled") return "This preview is read-only. Thumbs work on the live site.";
  if (code === "stale_patch") return "A new patch is out. Refresh the page, then tap again.";
  if (code === "unknown_issue") return "This issue is no longer on the board. Refresh the page.";
  if (code === "thumbs_unavailable") return "Thumbs are not available right now. Try again later.";
  if (code === "turnstile_unavailable") return "Bot protection is unavailable, so your tap was not saved.";
  if (code === "captcha_failed") return "The bot check failed. Tap again.";
  if (code === "current_patch_unavailable") return "The current patch could not be checked. Try again later.";
  if (status === 429) return "Too many taps from this network. Try again later.";
  return "Your tap was not saved. Try again.";
}

/**
 * A thumb up or down on one issue for the current patch. It shows only this
 * device's own choice, never a count. Tapping the lit thumb takes it back.
 */
export function IssueThumbs({ clusterId, patchVersion }: { clusterId: string; patchVersion: string }) {
  const saved = useSyncExternalStore(subscribeToThumbs, () => readThumb(clusterId, patchVersion), () => null);
  const [pending, setPending] = useState<{ choice: Choice; attempt: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  // The thumb this visit just saved: it lands with a short stamp, once.
  const [stamped, setStamped] = useState<ThumbDirection | null>(null);
  const inFlight = useRef(false);
  const promptId = useId();
  const gapId = `thumb-gap-${promptId.replace(/[^\w-]/g, "")}`;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const target = pending?.choice ?? null;

  function tap(direction: ThumbDirection) {
    if (inFlight.current) return;
    if (!siteKey) {
      setNote({ text: "Bot protection is unavailable, so taps cannot be saved right now.", failed: true });
      return;
    }
    setNote(null);
    setStamped(null);
    setPending((current) => ({ choice: saved === direction ? "none" : direction, attempt: (current?.attempt ?? 0) + 1 }));
  }

  async function save(choice: Choice, token: string) {
    // A widget can call back again (a refreshed token): only the first saves.
    if (!token || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const response = await fetch("/api/thumbs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cluster_id: clusterId, patch_version: patchVersion, direction: choice, turnstile_token: token }),
      });
      if (response.ok) {
        writeThumb(clusterId, patchVersion, choice);
        setStamped(choice === "none" ? null : choice);
        setNote({ text: choice === "none" ? "Undone." : "Saved on this device. Tap again to undo.", failed: false });
      } else {
        const payload: unknown = await response.json().catch(() => null);
        const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : null;
        setNote({ text: failureText(code, response.status), failed: true });
      }
    } catch {
      setNote({ text: "Your tap was not saved. Try again.", failed: true });
    } finally {
      inFlight.current = false;
      setSending(false);
      setPending(null);
    }
  }

  return (
    <div className="issue-thumbs">
      <div className="issue-thumbs__row">
        <span id={promptId} className="issue-thumbs__prompt">Happening to you on {patchVersion}?</span>
        <div className="issue-thumbs__buttons" role="group" aria-labelledby={promptId}>
          {THUMB_DIRECTIONS.map((direction) => {
            const pressed = saved === direction;
            // While a tap is checked and saved, the thumb it lights or clears shows half-inked.
            const changing = target === direction ? "on" : target !== null && pressed ? "off" : undefined;
            return (
              <button
                key={direction}
                type="button"
                className={`issue-thumbs__button issue-thumbs__button--${direction}`}
                aria-label={LABELS[direction]}
                aria-pressed={pressed}
                data-pending={changing}
                data-stamped={stamped === direction && pressed ? "" : undefined}
                disabled={sending}
                onClick={() => tap(direction)}
              >
                <ThumbGlyph direction={direction} gapId={`${gapId}-${direction}`} />
              </button>
            );
          })}
        </div>
      </div>
      {pending && siteKey ? (
        <div className="issue-thumbs__check">
          <ReportCaptcha
            key={pending.attempt}
            siteKey={siteKey}
            appearance="interaction-only"
            onToken={(token) => void save(pending.choice, token)}
            onError={() => {
              setPending(null);
              setNote({ text: "The bot check could not load. Check your connection or try again later.", failed: true });
            }}
          />
        </div>
      ) : null}
      <p className="issue-thumbs__note" role="status" aria-live="polite">{sending ? "Saving…" : pending ? "Checking…" : note && !note.failed ? note.text : ""}</p>
      {note?.failed ? <p className="issue-thumbs__note issue-thumbs__note--error" role="alert">{note.text}</p> : null}
    </div>
  );
}
