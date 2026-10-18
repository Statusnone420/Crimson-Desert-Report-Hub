import type { PointerEvent } from "react";

/**
 * A mouse changes a chart's reading only on a click or while dragging with the
 * button held; passing over a chart changes nothing. Touch and pen keep their
 * own handling.
 */
export function isMouseHover(event: { pointerType: string; buttons: number }) {
  return event.pointerType === "mouse" && (event.buttons & 1) === 0;
}

/** Selects on a primary mouse press, and keeps a drag on the chart if the pointer slips off it. */
export function pressToSelect<T extends Element>(event: PointerEvent<T>, select: (event: PointerEvent<T>) => void) {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  select(event);
}
