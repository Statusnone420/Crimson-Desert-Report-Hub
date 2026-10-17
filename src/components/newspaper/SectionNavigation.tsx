"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DirectionIcon } from "./ReadingLink";

export type ReadingSection = { id: string; label: string };

/** Scroll position is an enhancement. Links, hashes and browser history remain native. */
export function SectionNavigation({ sections, label = "On this page", variant = "bar" }: { sections: readonly ReadingSection[]; label?: string; variant?: "bar" | "rail" }) {
  const [active, setActive] = useState("");
  const instance = useId();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const targets = sections.flatMap(({ id }) => {
      const element = document.getElementById(id);
      return element ? [{ id, element }] : [];
    });
    let frame = 0;
    const update = () => {
      frame = 0;
      const readingLine = Math.min(window.innerHeight * .28, 240);
      let current = "";
      for (const { id, element } of targets) {
        if (element.getBoundingClientRect().top <= readingLine) current = id;
      }
      const last = targets.at(-1);
      // Short final sections cannot always reach the reading line.
      if (last && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2 && last.element.getBoundingClientRect().top < window.innerHeight) current = last.id;
      setActive((previous) => previous === current ? previous : current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [sections]);

  return (
    <nav className={`section-nav section-nav--${variant}`} aria-label={label}>
      <span className="section-nav__caption">{variant === "bar" ? "On this page" : label}</span>
      <div className="section-nav__links">
        {sections.map(({ id, label: sectionLabel }) => (
          <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
            <span>{sectionLabel}</span>
            <DirectionIcon direction="down" />
            {active === id ? <motion.span className="section-nav__marker" layoutId={`reading-section-${instance}`} transition={{ duration: reducedMotion ? 0 : .22, ease: [.22, 1, .36, 1] }} /> : null}
          </a>
        ))}
      </div>
    </nav>
  );
}
