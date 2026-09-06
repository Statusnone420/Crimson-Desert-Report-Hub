"use client";

import { useSyncExternalStore } from "react";

const subscribeTheme = (callback: () => void) => {
  window.addEventListener("newspaper-theme", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("newspaper-theme", callback);
    window.removeEventListener("storage", callback);
  };
};
const themeSnapshot = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const serverTheme = () => "light" as const;

export function useNewspaperTheme() {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, serverTheme);
}
