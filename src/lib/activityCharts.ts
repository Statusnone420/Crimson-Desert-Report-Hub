/**
 * Geometry for the server-drawn activity charts. Marks are drawn in a 1000-unit
 * wide viewBox stretched to the container; text sits in HTML at the same
 * percentages, so labels stay readable at any width.
 */

export const CHART_WIDTH = 1000;
export const PANEL_HEIGHT = 100;

/** Centre of a day's slot, in percent of the plot width. */
export function slotCenter(index: number, count: number): number {
  return count > 0 ? ((index + 0.5) / count) * 100 : 0;
}

/** A round axis top at or above the value, from the 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 series. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((multiple) => value / power <= multiple + 1e-9) ?? 10;
  return step * power;
}

export function compactNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}`.replace(/\.0$/, "") + "K";
  return String(Math.round(value));
}

function y(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return PANEL_HEIGHT - ((clamped - min) / (max - min)) * PANEL_HEIGHT;
}

/** A line through each day's value, broken wherever a day has none. */
export function linePath(values: (number | null)[], min: number, max: number): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    const x = (slotCenter(index, values.length) / 100) * CHART_WIDTH;
    path += `${drawing ? "L" : "M"}${x.toFixed(1)},${y(value, min, max).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

/** Closed shapes between two series (or a series and the baseline), one per unbroken run of days. */
export function bandPath(lows: (number | null)[], highs: (number | null)[], min: number, max: number): string {
  const runs: number[][] = [];
  highs.forEach((high, index) => {
    if (high === null || lows[index] === null) return;
    const run = runs.at(-1);
    if (run && run.at(-1) === index - 1) run.push(index);
    else runs.push([index]);
  });
  const slot = CHART_WIDTH / Math.max(1, highs.length);
  return runs.map((run) => {
    // A lone day fills its slot so it still shows as a mark.
    const points = run.length === 1
      ? [{ index: run[0], x: run[0] * slot }, { index: run[0], x: (run[0] + 1) * slot }]
      : run.map((index) => ({ index, x: (index + 0.5) * slot }));
    const top = points.map(({ index, x }, position) => `${position ? "L" : "M"}${x.toFixed(1)},${y(highs[index]!, min, max).toFixed(1)}`);
    const bottom = [...points].reverse().map(({ index, x }) => `L${x.toFixed(1)},${y(lows[index]!, min, max).toFixed(1)}`);
    return `${top.join("")}${bottom.join("")}Z`;
  }).join("");
}

/** Runs of points placed by time; a gap longer than `maxGapMs` starts a new run. */
function timeRuns<T extends { time: number }>(points: T[], maxGapMs: number): T[][] {
  const runs: T[][] = [];
  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    const run = runs.at(-1);
    if (run && point.time - run.at(-1)!.time <= maxGapMs) run.push(point);
    else runs.push([point]);
  }
  return runs;
}

const timeX = (time: number, from: number, to: number) => (to > from ? ((time - from) / (to - from)) * CHART_WIDTH : 0);

export function timeLinePath(points: { time: number; value: number }[], from: number, to: number, max: number, maxGapMs: number): string {
  return timeRuns(points, maxGapMs)
    .map((run) => run.map((point, index) => `${index ? "L" : "M"}${timeX(point.time, from, to).toFixed(1)},${y(point.value, 0, max).toFixed(1)}`).join(""))
    .join("");
}

export function timeBandPath(points: { time: number; low: number; high: number }[], from: number, to: number, max: number, maxGapMs: number): string {
  return timeRuns(points, maxGapMs)
    .filter((run) => run.length > 1)
    .map((run) => {
      const top = run.map((point, index) => `${index ? "L" : "M"}${timeX(point.time, from, to).toFixed(1)},${y(point.high, 0, max).toFixed(1)}`);
      const bottom = [...run].reverse().map((point) => `L${timeX(point.time, from, to).toFixed(1)},${y(point.low, 0, max).toFixed(1)}`);
      return `${top.join("")}${bottom.join("")}Z`;
    })
    .join("");
}

export type ColumnRect = { index: number; x: number; width: number; y: number; height: number };

/** One column per day with a value above zero; the slot keeps a gap on each side. */
export function columnRects(values: (number | null)[], max: number): ColumnRect[] {
  const slot = CHART_WIDTH / Math.max(1, values.length);
  const width = Math.max(1, Math.min(slot * 0.7, slot - 2));
  return values.flatMap((value, index) => {
    if (value === null || value <= 0) return [];
    const top = y(value, 0, max);
    return [{ index, x: index * slot + (slot - width) / 2, width, y: top, height: PANEL_HEIGHT - top }];
  });
}

export type AxisTick = { value: number; top: number; label: string };

export function axisTicks(min: number, max: number, format: (value: number) => string = compactNumber): AxisTick[] {
  return [min, (min + max) / 2, max].map((value) => ({ value, top: (y(value, min, max) / PANEL_HEIGHT) * 100, label: format(value) }));
}

export type PatchMarker = {
  version: string;
  publishedAt: string;
  fixes: number;
  update: boolean;
  /** Percent across the plot. */
  x: number;
  /** "always" labels fit a 320px phone; "wide" ones show from tablet width up. */
  label: "always" | "wide" | null;
};

const ALWAYS_LABEL_SPACING = 11;
const WIDE_LABEL_SPACING = 3.5;

/**
 * Official releases inside the plotted days. Updates (x.yy.00) carry a label,
 * thinned so neighbours never collide; hotfixes are ticks without one.
 */
export function patchMarkers(
  days: { day: string }[],
  patches: { version: string; publishedAt: string | null; fixes: number }[],
): PatchMarker[] {
  if (!days.length) return [];
  const first = Date.parse(`${days[0].day}T00:00:00Z`);
  const end = Date.parse(`${days.at(-1)!.day}T00:00:00Z`) + 86_400_000;
  let lastAlways = -Infinity;
  let lastWide = -Infinity;
  return patches
    .flatMap((patch) => {
      const time = patch.publishedAt ? Date.parse(patch.publishedAt) : Number.NaN;
      return Number.isFinite(time) && time >= first && time < end ? [{ ...patch, publishedAt: patch.publishedAt!, time }] : [];
    })
    .sort((a, b) => a.time - b.time)
    .map((patch) => {
      const x = ((patch.time - first) / (end - first)) * 100;
      const update = /\.00$/.test(patch.version);
      let label: PatchMarker["label"] = null;
      if (update && x - lastAlways >= ALWAYS_LABEL_SPACING) {
        label = "always";
        lastAlways = x;
        lastWide = x;
      } else if (update && x - lastWide >= WIDE_LABEL_SPACING) {
        label = "wide";
        lastWide = x;
      }
      return { version: patch.version, publishedAt: patch.publishedAt, fixes: patch.fixes, update, x, label };
    });
}

export function shortVersion(version: string): string {
  return version.replace(/\.00$/, "");
}

/** The first of each month inside the plotted days. */
export function monthTicks(days: { day: string }[]): { x: number; label: string }[] {
  return days.flatMap((day, index) => day.day.endsWith("-01")
    ? [{ x: (index / days.length) * 100, label: new Date(`${day.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) }]
    : []);
}
