import { CATEGORIES, type Category } from "@/lib/constants";

/**
 * What the scanner is watching on the current patch, as counts only: Steam
 * forum threads first seen since the patch that it grouped into a topic, those
 * topics, and the busiest systems. A thread kept without a topic is not counted.
 * Thread titles, links and text stay private.
 */
export type BoardWatchSummary = {
  patchVersion: string;
  threads: number;
  topics: number;
  systems: { category: Category; threads: number }[];
};

export function summarizeBoardWatch(rows: { category?: unknown; cluster_id?: unknown }[], patchVersion: string): BoardWatchSummary {
  const bySystem = new Map<Category, number>();
  const topics = new Set<string>();
  let threads = 0;
  for (const row of rows) {
    if (typeof row.cluster_id !== "string" || !row.cluster_id) continue;
    topics.add(row.cluster_id);
    threads += 1;
    const category = typeof row.category === "string" && (CATEGORIES as readonly string[]).includes(row.category)
      ? (row.category as Category) : "other";
    bySystem.set(category, (bySystem.get(category) ?? 0) + 1);
  }
  const systems = [...bySystem.entries()]
    .map(([category, threads]) => ({ category, threads }))
    .sort((a, b) => b.threads - a.threads || a.category.localeCompare(b.category));
  return { patchVersion, threads, topics: topics.size, systems };
}
