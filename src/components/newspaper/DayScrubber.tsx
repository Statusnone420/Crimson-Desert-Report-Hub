"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { isMouseHover, pressToSelect } from "./pointerIntent";

export type ScrubItem = { x: number; title: string; detail: string };

/** Pixels a touch may travel and still count as a tap. */
const TAP_SLOP = 10;

/**
 * Adds a cursor, a readout and a keyboard slider to a server-drawn chart.
 * A mouse selects the nearest day on a click, or while dragging with the button
 * held; passing over the chart changes nothing. A touch selects on a tap or a
 * sideways drag, so scrolling past the chart never changes the day. The slider
 * announces each day through its value text; the readout repeats it on screen
 * only, so nothing is read twice. Previous and Next give touch a 44px target;
 * keyboards use the slider's arrow keys, so the buttons stay out of the tab order.
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
  const touch = useRef<{ pointer: number; x: number; y: number; dragging: boolean } | null>(null);
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
  const step = (by: number) => setIndex((current) => Math.min(items.length - 1, Math.max(0, current + by)));
  return (
    <div className="dd-scrub">
      <div className="dd-scrub-area">
        {children}
        <span className="dd-cursor" style={{ left: `${item.x}%` }} aria-hidden="true" />
        <div
          className="dd-hit"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") pressToSelect(event, pick);
            else touch.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") {
              if (!isMouseHover(event)) pick(event);
              return;
            }
            const start = touch.current;
            if (!start || start.pointer !== event.pointerId) return;
            const across = Math.abs(event.clientX - start.x);
            if (!start.dragging && across > TAP_SLOP && across > Math.abs(event.clientY - start.y)) start.dragging = true;
            if (start.dragging) pick(event);
          }}
          onPointerUp={(event) => {
            const start = touch.current;
            touch.current = null;
            if (event.pointerType === "mouse" || !start || start.pointer !== event.pointerId) return;
            if (start.dragging || Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP) pick(event);
          }}
          onPointerCancel={() => { touch.current = null; }}
        />
      </div>
      <p className="dd-readout" id={`${id}-readout`}>
        <strong>{item.title}</strong> <span>{item.detail}</span>
      </p>
      <div className="dd-stepper">
        <button type="button" className="dd-step" tabIndex={-1} aria-label="Previous day" disabled={index === 0} onClick={() => step(-1)}>
          <span aria-hidden="true">‹</span>
        </button>
        <input
          id={`${id}-slider`}
          className="dd-slider-input"
          type="range"
          min={0}
          max={items.length - 1}
          step={1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-label={label}
          aria-valuetext={`${item.title}: ${item.detail}`}
        />
        <button type="button" className="dd-step" tabIndex={-1} aria-label="Next day" disabled={index === items.length - 1} onClick={() => step(1)}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
