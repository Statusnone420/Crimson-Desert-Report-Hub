import type { Category } from "@/lib/constants";

export type RoutableCluster = {
  id: string;
  slug: string;
  title: string;
  category: Category | string;
};

export type RoutingInput = {
  issueTitle: string;
  summary: string;
  category: Category;
  /** clusterSlug proposed by the LLM, already validated against known slugs (or null). */
  llmClusterSlug: string | null;
};

const KEYWORD_ROUTES: { slug: string; category: Category; patterns: RegExp[] }[] = [
  { slug: "map_open_crash_persistent", category: "crash_startup", patterns: [/\bmap\b/i] },
  { slug: "boss_rematch_crash_persistent", category: "crash_startup", patterns: [/\bboss\b/i, /\brematch\b/i] },
  { slug: "crash_startup_hang", category: "crash_startup", patterns: [/crash/i, /freez/i, /hang/i, /\bctd\b/i, /won'?t (start|launch|load)/i] },
  { slug: "hardware_driver_specific", category: "performance", patterns: [/\bdriver\b/i, /\bnvidia\b/i, /\bamd\b/i, /\bintel arc\b/i, /\brtx\b/i, /\bgtx\b/i, /\bradeon\b/i] },
  { slug: "performance_regression", category: "performance", patterns: [/\bfps\b/i, /stutter/i, /frame ?(rate|pacing|drops?)/i, /performance/i, /\blag\b/i] },
  { slug: "controls_input_gameplay", category: "controls_gameplay", patterns: [/\bhorse\b/i, /\bmount\b/i, /\binput\b/i, /control/i, /lock(s|ed)? ?up/i, /unresponsive/i, /title screen/i] },
];

/**
 * Pick the watchlist cluster a signal belongs to.
 * Preference order: validated LLM assignment > keyword route (first match wins,
 * ordered most-specific first) > null (caller creates a new cluster).
 */
export function routeToWatchlistCluster(input: RoutingInput, clusters: RoutableCluster[]): RoutableCluster | null {
  const bySlug = new Map(clusters.map((cluster) => [cluster.slug, cluster]));

  if (input.llmClusterSlug) {
    const match = bySlug.get(input.llmClusterSlug);
    if (match) return match;
  }

  const text = `${input.issueTitle} ${input.summary}`;
  for (const route of KEYWORD_ROUTES) {
    if (route.category !== input.category) continue;
    if (!bySlug.has(route.slug)) continue;
    if (route.patterns.some((pattern) => pattern.test(text))) return bySlug.get(route.slug) ?? null;
  }
  return null;
}
