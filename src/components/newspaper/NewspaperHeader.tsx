"use client";

import Link from "next/link";
import Image from "next/image";
import { useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";

const subscribeTheme = (callback: () => void) => {
  window.addEventListener("newspaper-theme", callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener("newspaper-theme", callback); window.removeEventListener("storage", callback); };
};
const themeSnapshot = () => document.documentElement.dataset.theme || "dark";
const serverTheme = () => "dark";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, serverTheme);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("newspaper-theme", next); } catch { /* Theme still works for this visit. */ }
    window.dispatchEvent(new Event("newspaper-theme"));
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}><span className="theme-icon"><Image loading="eager" src={theme === "dark" ? "/icons/sun.svg" : "/icons/moon.svg"} alt="" width={21} height={21}/></span></button>;
}

export function NewspaperHeader({ active, date, home = false }: { active?: string; date: string; home?: boolean }) {
  const reducedMotion = useReducedMotion();
  const Masthead = home ? "h1" : "div";
  return <header><div className="topline"><div>{date}</div><div className="theme"><ThemeToggle/></div></div><Masthead className="masthead"><Link href="/">Crimson Desert <em>Report Hub</em></Link></Masthead><nav aria-label="Main navigation">{[["news", "/news", "News"], ["expansion", "/topics/charting-the-unknown", "Expansion"], ["watch", "/watch", "Watch"], ["patches", "/patches", "Patches"]].map(([key, href, label]) => <Link key={key} href={href} aria-current={(active === key || (key === "news" && active === "brief")) ? "page" : undefined}>{label}{(active === key || (key === "news" && active === "brief")) && <motion.span className="nav-indicator" layoutId="newspaper-nav" transition={{ duration: reducedMotion ? 0 : .28 }}/>}</Link>)}<Link className="observatory-link" href="/observatory" aria-current={active === "observatory" ? "page" : undefined}>Observatory <span aria-hidden="true">→</span></Link></nav></header>;
}
