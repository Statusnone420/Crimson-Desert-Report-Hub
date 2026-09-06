"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { CATCH_UP_COVERAGE_START, CATCH_UP_HIGHLIGHTS_START, CATCH_UP_MILESTONES } from "@/lib/catchUpContent";
import { catchUpDate, catchUpHash, parseCatchUpHash, type CatchUpSelection } from "@/lib/catchUp";
import { useCatchUp } from "./CatchUpContext";

type Mode = "highlights" | "date" | "patch" | "all";
const MODES: { value: Mode; label: string }[] = [
  { value: "highlights", label: "Recent" },
  { value: "date", label: "Date" },
  { value: "patch", label: "Patch" },
  { value: "all", label: "All" },
];
const PATCHES = CATCH_UP_MILESTONES.filter((item) => item.patch).toReversed();

export function CatchUpMenu({ label = "Catch me up", compact = false }: { label?: string; compact?: boolean }) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const patchList = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("highlights");
  const [date, setDate] = useState("");
  const [patch, setPatch] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const reduced = useReducedMotion();
  const { ready, available, preferences, previousVisit, setRemember } = useCatchUp();
  const close = () => popover.current?.hidePopover();

  useEffect(() => {
    if (open && mode === "patch") patchList.current?.querySelector("input:checked")?.scrollIntoView({ block: "nearest" });
  }, [open, mode]);

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1 : (index + offset + MODES.length) % MODES.length;
    changeMode(MODES[next].value);
    tabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }
  function navigate(selection: CatchUpSelection) {
    const hash = catchUpHash(selection);
    close();
    if (window.location.pathname === "/catch-up") {
      window.history.replaceState(null, "", `/catch-up${hash}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
    } else router.push(`/catch-up${hash}`);
  }
  function choose(event: FormEvent) {
    event.preventDefault();
    if (mode === "highlights" || mode === "all") { navigate({ kind: mode }); return; }
    if (mode === "patch") {
      if (!patch) { setError("Choose the last patch you played."); return; }
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
  function synchronizeOpen(showing: boolean) {
    setOpen(showing);
    if (!showing) return;
    setError("");
    const selection = window.location.pathname === "/catch-up" ? parseCatchUpHash(window.location.hash) : { kind: "highlights" as const };
    setMode(selection.kind === "since" ? "date" : selection.kind);
    setDate(selection.kind === "since" ? selection.value.slice(0, 10) : "");
    setPatch(selection.kind === "patch" ? selection.value : "");
  }
  return <>
    <button type="button" className={`catch-up-trigger${compact ? " catch-up-trigger--compact" : ""}`} popoverTarget={id} aria-haspopup="dialog" disabled={!ready}>
      {label}<svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13M10 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5"/></svg>
    </button>
    <div id={id} ref={popover} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className="catch-up-popover" onBeforeToggle={(event) => synchronizeOpen(event.newState === "open")}>
      <div className="catch-up-menu">
        <div className="catch-up-menu-heading"><h2 id={`${id}-title`}>Catch up</h2><button type="button" className="catch-up-close" popoverTarget={id} popoverTargetAction="hide" aria-label="Close catch-up options"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5"/></svg></button></div>
        {ready && (preferences.caughtUpThrough || previousVisit) && <div className="catch-up-saved">
          {preferences.caughtUpThrough && <button type="button" onClick={() => navigate({ kind: "since", value: preferences.caughtUpThrough! })}>Where I left off <span>{catchUpDate(preferences.caughtUpThrough)} →</span></button>}
          {previousVisit && <button type="button" onClick={() => navigate({ kind: "since", value: previousVisit })}>Since my last visit <span>{catchUpDate(previousVisit)} →</span></button>}
        </div>}
        <form onSubmit={choose}>
          <div className="catch-up-tabs" ref={tabs} role="tablist" aria-label="Catch-up starting point">{MODES.map((item, index) => <button key={item.value} id={`${id}-tab-${item.value}`} type="button" role="tab" aria-selected={mode === item.value} aria-controls={`${id}-panel`} tabIndex={mode === item.value ? 0 : -1} onClick={() => changeMode(item.value)} onKeyDown={(event) => moveTab(event, index)}>{item.label}</button>)}</div>
          <div className="catch-up-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${mode}`}>
            {mode === "highlights" && <div className="catch-up-view-note"><strong>Recent updates and announcements</strong><p>{catchUpDate(CATCH_UP_HIGHLIGHTS_START)} – {catchUpDate(CATCH_UP_MILESTONES.at(-1)!.publishedAt)}</p></div>}
            {mode === "all" && <div className="catch-up-view-note"><strong>Every update from patch {CATCH_UP_MILESTONES[0].patch}</strong><p>{catchUpDate(CATCH_UP_COVERAGE_START)} – {catchUpDate(CATCH_UP_MILESTONES.at(-1)!.publishedAt)}</p></div>}
            {mode === "date" && <label className="catch-up-date">Last played<input type="date" value={date} max={ready ? new Date().toISOString().slice(0, 10) : undefined} onChange={(event) => { setDate(event.target.value); setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}/></label>}
            {mode === "patch" && <fieldset className="catch-up-patches"><legend>Last patch played</legend><p id={`${id}-patch-hint`}>Shows later updates. {PATCHES.length} patches, newest first.</p><div className="catch-up-patch-list" ref={patchList}>{PATCHES.map((item) => <label key={item.id} className={patch === item.patch ? "is-selected" : undefined}><input type="radio" name={`${id}-patch`} value={item.patch} checked={patch === item.patch} onChange={() => { setPatch(item.patch!); setError(""); }} aria-describedby={`${id}-patch-hint`}/><span>{item.patch}</span><time dateTime={item.publishedAt}>{catchUpDate(item.publishedAt)}</time></label>)}</div></fieldset>}
          </div>
          {error && <p id={`${id}-error`} className="catch-up-error" role="alert">{error}</p>}
          <button type="submit" className="catch-up-primary catch-up-submit">Show updates <span aria-hidden="true">→</span></button>
        </form>
        <div className="catch-up-memory"><label><input type="checkbox" checked={preferences.remember} disabled={!ready || !available} onChange={(event) => setRemember(event.target.checked)}/><span>Remember my place on this browser</span></label><p>{available ? "Saved here only. Turn off to clear your dates." : "Browser storage is unavailable. Date and patch choices still work."} <Link href="/privacy" onClick={close}>Privacy</Link></p></div>
      </div>
    </div>
  </>;
}
