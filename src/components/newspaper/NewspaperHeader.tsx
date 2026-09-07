"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { DeskDate } from "./DeskDate";
import { useNewspaperTheme } from "./useNewspaperTheme";
import { CatchUpMenu } from "@/components/catchup/CatchUpMenu";

export function ThemeToggle() {
  const theme = useNewspaperTheme();
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("newspaper-theme", next); } catch { /* Theme still works for this visit. */ }
    window.dispatchEvent(new Event("newspaper-theme"));
  }
  return <><meta name="theme-color" content={theme === "dark" ? "#000000" : "#f6f4ee"}/><button className="theme-toggle" type="button" onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}><span className="theme-icon"><Image loading="eager" src={theme === "dark" ? "/icons/sun.svg" : "/icons/moon.svg"} alt="" width={21} height={21}/></span></button></>;
}

export function NewspaperHeader({ active, home = false }: { active?: string; home?: boolean }) {
  const reducedMotion = useReducedMotion();
  const Masthead = home ? "h1" : "div";
  return <header><div className="topline"><div><DeskDate/></div><div className="theme"><CatchUpMenu compact/><ThemeToggle/></div></div><Masthead className="masthead"><Link href="/">Crimson Desert <em>Report Hub</em></Link></Masthead><nav aria-label="Main navigation">{[["brief", "/", "News"], ["patches", "/patches", "Patches"], ["issues", "/issues", "Player reports"], ["observatory", "/observatory", "Observatory"]].map(([key, href, label]) => <Link key={key} href={href} aria-current={(active === key || (key === "brief" && active === "news")) ? "page" : undefined}>{label}{(active === key || (key === "brief" && active === "news")) && <motion.span className="nav-indicator" layoutId="newspaper-nav" transition={{ duration: reducedMotion ? 0 : .28 }}/>}</Link>)}<Link className="file" href="/report" aria-current={active === "report" ? "page" : undefined}>File a report <span aria-hidden="true">→</span></Link></nav></header>;
}
