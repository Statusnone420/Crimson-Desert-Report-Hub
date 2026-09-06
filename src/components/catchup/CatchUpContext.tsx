"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CATCH_UP_STORAGE_KEY, readCatchUpPreferences, writeCatchUpPreferences, type CatchUpPreferences } from "@/lib/catchUpPreferences";

type CatchUpState = { ready: boolean; available: boolean; previousVisit: string | null; preferences: CatchUpPreferences };
const initial: CatchUpState = { ready: false, available: true, previousVisit: null, preferences: { remember: true, lastVisit: null, caughtUpThrough: null } };
let snapshot = initial;
let initialized = false;
let visitStarted = false;
const isPublicPath = (pathname: string) => !/^\/(admin|operator)(\/|$)/.test(pathname);
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;
const getServerSnapshot = () => initial;
const notify = () => listeners.forEach((listener) => listener());

function save(preferences: CatchUpPreferences, previousVisit = snapshot.previousVisit) {
  let available = false;
  try { available = writeCatchUpPreferences(window.localStorage, preferences); } catch { /* Storage can be blocked before a method is called. */ }
  snapshot = { ready: true, available, preferences, previousVisit };
  notify();
  return available;
}

function initializePreferences() {
  if (initialized) return;
  initialized = true;
  let result: ReturnType<typeof readCatchUpPreferences>;
  try { result = readCatchUpPreferences(window.localStorage); }
  catch { result = { preferences: initial.preferences, available: false }; }
  snapshot = { ready: true, available: result.available, preferences: result.preferences, previousVisit: result.preferences.lastVisit };
  notify();
}

function startVisit() {
  if (visitStarted) return;
  visitStarted = true;
  if (snapshot.preferences.remember && snapshot.available) updateTimestamp("lastVisit");
}

function setRemember(remember: boolean) {
  save(remember
    ? { ...snapshot.preferences, remember: true, lastVisit: isPublicPath(window.location.pathname) ? new Date().toISOString() : snapshot.preferences.lastVisit }
    : { remember: false, lastVisit: null, caughtUpThrough: null }, remember ? snapshot.previousVisit : null);
}

function updateTimestamp(field: "lastVisit" | "caughtUpThrough") {
  let result: ReturnType<typeof readCatchUpPreferences>;
  try { result = readCatchUpPreferences(window.localStorage); }
  catch { result = { preferences: snapshot.preferences, available: false }; }
  if (!result.available || !result.preferences.remember) {
    snapshot = { ...snapshot, ...result, previousVisit: result.preferences.remember ? snapshot.previousVisit : null };
    notify();
    return false;
  }
  return save({ ...result.preferences, [field]: new Date().toISOString() });
}

const markCaughtUp = () => updateTimestamp("caughtUpThrough");

const CatchUpContext = createContext({ ...initial, setRemember, markCaughtUp });

export function CatchUpProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();
  useEffect(() => {
    initializePreferences();
    if (isPublicPath(pathname)) startVisit();
  }, [pathname]);
  useEffect(() => {
    const finishVisit = () => {
      if (visitStarted && isPublicPath(window.location.pathname) && snapshot.preferences.remember && snapshot.available) updateTimestamp("lastVisit");
    };
    const synchronize = (event: StorageEvent) => {
      if (event.key !== CATCH_UP_STORAGE_KEY && event.key !== null) return;
      let result: ReturnType<typeof readCatchUpPreferences>;
      try { result = readCatchUpPreferences(window.localStorage); } catch { return; }
      snapshot = { ...snapshot, preferences: result.preferences, available: result.available, previousVisit: result.preferences.remember ? snapshot.previousVisit : null };
      notify();
    };
    window.addEventListener("pagehide", finishVisit);
    window.addEventListener("storage", synchronize);
    return () => { window.removeEventListener("pagehide", finishVisit); window.removeEventListener("storage", synchronize); };
  }, []);
  return <CatchUpContext.Provider value={{ ...state, setRemember, markCaughtUp }}>{children}</CatchUpContext.Provider>;
}

export function useCatchUp() { return useContext(CatchUpContext); }
