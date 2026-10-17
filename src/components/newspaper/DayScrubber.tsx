"use client";

import { useState, type PointerEvent, type ReactNode } from "react";

export type ScrubItem = { x: number; title: string; detail: string };

/**
 * Adds a crosshair, a readout and a keyboard slider to a server-drawn chart.
 * The pointer selects the nearest day; the slider reaches every day without a
 * pointer, and the readout announces the selection.
 */
export function DayScrubber({
  id,
  label,
  items,
  initialIndex,
  children,
}: {
  id: string;
  label: string;
  items: ScrubItem[];
  initialIndex: number;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)));
  const item = items[index];
  if (!item) return <div className="dd-scrub">{children}</div>;
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const at = ((event.clientX - bounds.left) / bounds.width) * 100;
    let nearest = 0;
    items.forEach((candidate, candidateIndex) => {
      if (Math.abs(candidate.x - at) < Math.abs(items[nearest].x - at)) nearest = candidateIndex;
    });
    setIndex(nearest);
  };
  return (
    <div className="dd-scrub">
      <p className="dd-readout" id={`${id}-readout`} aria-live="polite">
        <strong>{item.title}</strong> <span>{item.detail}</span>
      </p>
      <div className="dd-scrub-area">
        {children}
        <span className="dd-cursor" style={{ left: `${item.x}%` }} aria-hidden="true" />
        <div className="dd-hit" onPointerMove={pick} onPointerDown={pick} aria-hidden="true" />
      </div>
      <label className="dd-slider" htmlFor={`${id}-slider`}>{label}</label>
      <input
        id={`${id}-slider`}
        className="dd-slider-input"
        type="range"
        min={0}
        max={items.length - 1}
        step={1}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
        aria-valuetext={`${item.title}: ${item.detail}`}
      />
    </div>
  );
}
