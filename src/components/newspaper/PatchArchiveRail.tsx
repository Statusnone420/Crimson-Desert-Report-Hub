"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { DirectionIcon } from "@/components/newspaper/ReadingLink";

/** Server-rendered cards stay readable with native scrolling before hydration. */
export function PatchArchiveRail({ versions, children }: { versions: readonly string[]; children: ReactNode }) {
  const rail = useRef<HTMLOListElement>(null);
  const id = useId();
  const reducedMotion = useReducedMotion();
  const { scrollXProgress } = useScroll({ container: rail });
  const [scrubbing, setScrubbing] = useState(false);
  const [view, setView] = useState({ progress: 0, first: 0, last: 0, overflow: false });

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    function measure() {
      if (!element) return;
      const max = element.scrollWidth - element.clientWidth;
      const cards = Array.from(element.children) as HTMLElement[];
      const visible = cards.flatMap((card, index) => card.offsetLeft + card.offsetWidth > element.scrollLeft + 2 && card.offsetLeft < element.scrollLeft + element.clientWidth - 2 ? [index] : []);
      const next = { progress: max > 1 ? Math.round(element.scrollLeft / max * 1000) / 10 : 0, first: visible[0] ?? 0, last: visible.at(-1) ?? 0, overflow: max > 1 };
      setView((previous) => previous.progress === next.progress && previous.first === next.first && previous.last === next.last && previous.overflow === next.overflow ? previous : next);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, [versions]);

  function browse(direction: number) {
    const element = rail.current;
    if (!element) return;
    const first = element.children[0] as HTMLElement | undefined;
    const second = element.children[1] as HTMLElement | undefined;
    const step = first && second ? second.offsetLeft - first.offsetLeft : element.clientWidth;
    element.scrollBy({ left: direction * step, behavior: reducedMotion ? "instant" : "smooth" });
  }

  return <div className="patch-archive-browser">
    <ol ref={rail} id={id} className="patch-archive-rail" data-enhanced={view.overflow || undefined} data-scrubbing={scrubbing || undefined} aria-label="Patch previews, newest first">{children}</ol>
    <div className="patch-archive-controls" hidden={!view.overflow}>
      <div className="patch-archive-position"><span>{view.first + 1}–{view.last + 1} of {versions.length} patches</span><div className="patch-archive-buttons">
        <button type="button" aria-label="Show newer patches" aria-controls={id} disabled={view.progress <= 0} onClick={() => browse(-1)}><DirectionIcon direction="back" /></button>
        <button type="button" aria-label="Show older patches" aria-controls={id} disabled={view.progress >= 99.9} onClick={() => browse(1)}><DirectionIcon /></button>
      </div></div>
      <label className="patch-archive-scrubber">
        <span className="patch-archive-scrubber-label"><span>Newer</span><span>Older</span></span>
        <span className="patch-archive-track" aria-hidden="true"><motion.span style={{ scaleX: scrollXProgress }} /></span>
        <input type="range" min="0" max="100" step="0.1" value={view.progress} aria-label="Browse patch history" aria-valuetext={`Patches ${versions[view.first]} to ${versions[view.last]}`} aria-controls={id}
          onFocus={() => setScrubbing(true)} onBlur={() => setScrubbing(false)}
          onChange={(event) => {
            const element = rail.current;
            const progress = Number(event.target.value);
            setView((previous) => ({ ...previous, progress }));
            if (element) element.scrollTo({ left: (element.scrollWidth - element.clientWidth) * progress / 100, behavior: "instant" });
          }} />
      </label>
    </div>
  </div>;
}
