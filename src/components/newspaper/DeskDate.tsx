"use client";

import { useSyncExternalStore } from "react";

const formatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
  timeZone: "America/New_York",
});
const snapshot = () => formatter.format(new Date());
// Cached HTML and hydration share a timeless placeholder, never a build date.
const serverSnapshot = () => "Eastern Time";

function subscribe(callback: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  function tick() {
    callback();
    // Align tabs to the minute boundary, including New York midnight in DST.
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
  }
  tick();
  window.addEventListener("focus", callback);
  window.addEventListener("pageshow", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", callback);
    window.removeEventListener("pageshow", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}

export function DeskDate() {
  const date = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <span title="Desk date · America/New_York">{date}</span>;
}
