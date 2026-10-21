"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ReportCaptcha } from "@/components/newspaper/ReportCaptcha";
import { THUMB_DIRECTIONS, type ThumbDirection } from "@/lib/thumbs";

type Choice = ThumbDirection | "none";

const LABELS: Record<ThumbDirection, string> = {
  up: "Happening to me",
  down: "Not happening for me",
};

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
  const inFlight = useRef(false);
  const promptId = useId();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  function tap(direction: ThumbDirection) {
    if (inFlight.current) return;
    if (!siteKey) {
      setNote({ text: "Bot protection is unavailable, so taps cannot be saved right now.", failed: true });
      return;
    }
    setNote(null);
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
        setNote({ text: choice === "none" ? "Taken back." : "Saved on this device. Tap it again to take it back.", failed: false });
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
          {THUMB_DIRECTIONS.map((direction) => (
            <button
              key={direction}
              type="button"
              className={`issue-thumbs__button issue-thumbs__button--${direction}`}
              aria-label={LABELS[direction]}
              aria-pressed={saved === direction}
              title={LABELS[direction]}
              disabled={sending}
              onClick={() => tap(direction)}
            >
              <span className="issue-thumbs__icon" aria-hidden="true" />
            </button>
          ))}
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
