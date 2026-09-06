"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { CATCH_UP_COVERAGE_START, CATCH_UP_HIGHLIGHTS_START, CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { catchUpDate, catchUpHash, type CatchUpSelection } from "@/lib/catchUp";
import { useCatchUp } from "./CatchUpContext";

export function CatchUpMenu({ label = "Catch me up", compact = false }: { label?: string; compact?: boolean }) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [method, setMethod] = useState<"date" | "patch">("date");
  const [date, setDate] = useState("");
  const [patch, setPatch] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const reduced = useReducedMotion();
  const { ready, available, preferences, previousVisit, setRemember } = useCatchUp();
  const close = () => popover.current?.hidePopover();
  const navigate = (selection: CatchUpSelection) => {
    const hash = catchUpHash(selection);
    close();
    if (window.location.pathname === "/catch-up") {
      window.history.replaceState(null, "", `/catch-up${hash}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
    } else router.push(`/catch-up${hash}`);
  };
  function choose(event: FormEvent) {
    event.preventDefault();
    if (method === "patch") {
      if (!patch) { setError("Choose the patch you last played."); return; }
      navigate({ kind: "patch", value: patch });
      return;
    }
    const parsed = Date.parse(date);
    if (!date || !Number.isFinite(parsed) || parsed > Date.now() || new Date(parsed).toISOString().slice(0, 10) !== date) {
      setError("Choose today or an earlier date.");
      return;
    }
    navigate({ kind: "since", value: new Date(parsed).toISOString() });
  }
  const resume = preferences.caughtUpThrough;
  return <>
    <button type="button" className={`catch-up-trigger${compact ? " catch-up-trigger--compact" : ""}`} popoverTarget={id} aria-haspopup="dialog">
      {label}<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13M10 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5"/></svg>
    </button>
    <div id={id} ref={popover} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className="catch-up-popover" onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}>
      <motion.div className="catch-up-menu" initial={false} animate={{ opacity: open ? 1 : 0, y: open ? 0 : 8 }} transition={{ duration: reduced ? 0 : .2 }}>
        <div className="catch-up-menu-heading"><h2 id={`${id}-title`}>Where should we pick up?</h2><button type="button" className="catch-up-close" popoverTarget={id} popoverTargetAction="hide" aria-label="Close catch-up options"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5"/></svg></button></div>
        <div className="catch-up-choices">
          {ready && resume && <button type="button" onClick={() => navigate({ kind: "since", value: resume })}><strong>Where I left off</strong><span>You caught up on {catchUpDate(resume)}</span></button>}
          {ready && previousVisit && <button type="button" onClick={() => navigate({ kind: "since", value: previousVisit })}><strong>Since my last visit</strong><span>Since {catchUpDate(previousVisit)}</span></button>}
          <button type="button" onClick={() => { setCustom(!custom); setError(""); }} aria-expanded={custom} aria-controls={`${id}-custom`}><strong>Since I last played</strong><span>Date or patch · From {catchUpDate(CATCH_UP_COVERAGE_START)}</span></button>
          <button type="button" onClick={() => navigate({ kind: "highlights" })}><strong>Show me the highlights</strong><span>{catchUpDate(CATCH_UP_HIGHLIGHTS_START)} – {catchUpDate(CATCH_UP_MILESTONES.at(-1)!.publishedAt)}</span></button>
        </div>
        {custom && <form id={`${id}-custom`} className="catch-up-custom" onSubmit={choose}>
          <div className="catch-up-method" role="group" aria-label="Choose a starting point"><button type="button" aria-pressed={method === "date"} onClick={() => { setMethod("date"); setError(""); }}>By date</button><button type="button" aria-pressed={method === "patch"} onClick={() => { setMethod("patch"); setError(""); }}>By patch</button></div>
          {method === "date" ? <label>When did you last play?<input type="date" value={date} max={ready ? new Date().toISOString().slice(0, 10) : undefined} onChange={(event) => { setDate(event.target.value); setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}/></label>
            : <label>The last patch you played<select value={patch} onChange={(event) => { setPatch(event.target.value); setError(""); }}><option value="">Choose a patch</option>{CATCH_UP_MILESTONES.filter((item) => item.patch).map((item) => <option key={item.id} value={item.patch}>{item.patch} · {catchUpDate(item.publishedAt)}</option>)}</select></label>}
          {error && <p id={`${id}-error`} className="catch-up-error" role="alert">{error}</p>}
          <button type="submit" className="catch-up-primary">Build my catch-up <span aria-hidden="true">→</span></button>
        </form>}
        <div className="catch-up-memory"><label><input type="checkbox" checked={preferences.remember} disabled={!ready || !available} onChange={(event) => setRemember(event.target.checked)}/><span>Remember my place on this browser</span></label><p>{available ? "Turn off to clear your saved visit and catch-up dates." : "Browser storage is unavailable. Choose a date or patch instead."} <Link href="/privacy" onClick={close}>Privacy</Link></p></div>
      </motion.div>
    </div>
  </>;
}
