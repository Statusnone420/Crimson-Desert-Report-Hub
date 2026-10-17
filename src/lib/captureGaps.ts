/** Two real captures with no capture between them for longer than a chart's gap limit. */
export type CaptureGap<T> = { from: T; to: T };

/** The gaps between a chart's line segments, each joined only by its real end captures. */
export function captureGaps<T>(segments: T[][]): CaptureGap<T>[] {
  return segments.slice(1).map((segment, index) => ({ from: segments[index].at(-1)!, to: segment[0] }));
}

/**
 * The gap whose interior holds `time`. Up to `edgeMs` beside each end stays with
 * that capture, but never more than a quarter of the gap, so a short gap keeps
 * a hover target.
 */
export function gapAtTime<T extends { capturedAt: string }>(
  gaps: CaptureGap<T>[],
  time: number,
  edgeMs: number,
): CaptureGap<T> | null {
  return gaps.find(({ from, to }) => {
    const start = Date.parse(from.capturedAt);
    const end = Date.parse(to.capturedAt);
    const edge = Math.min(edgeMs, (end - start) / 4);
    return time > start + edge && time < end - edge;
  }) ?? null;
}
