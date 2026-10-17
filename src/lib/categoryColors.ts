/**
 * Fixed categorical chart colors, one per issue category — color follows the
 * category, never its rank, so every chart and legend on every surface paints
 * "performance" the same copper. The six hues were validated with the data-viz
 * palette checks (lightness band, chroma floor, CVD separation, normal-vision
 * floor, contrast) against the dispatch surface #110e0b; "other" is a
 * deliberately neutral ink because it is the miscellaneous bucket, not an
 * identity. Reserved semantic colors (crimson evidence, amber contested,
 * green fixed, blue lead register) are untouched.
 */
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/constants";

export const CATEGORY_CHART_COLORS: Record<string, string> = {
  performance: "var(--cat-performance)",
  crash_startup: "var(--cat-crash)",
  controls_gameplay: "var(--cat-controls)",
  graphics_visual: "var(--cat-graphics)",
  quest_progression: "var(--cat-quest)",
  audio: "var(--cat-audio)",
  other: "var(--cat-other)",
};

export function categoryChartColor(category: string): string {
  return CATEGORY_CHART_COLORS[category] ?? CATEGORY_CHART_COLORS.other;
}

/**
 * Chart categories in the FIXED enum order (hues follow the category, never
 * its rank), filtered to the keys actually present so charts never render
 * empty sectors or legend rows.
 */
export function chartCategories(present: Iterable<string>): { category: string; label: string; color: string }[] {
  const set = new Set(present);
  return CATEGORIES.filter((category) => set.has(category)).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    color: categoryChartColor(category),
  }));
}
