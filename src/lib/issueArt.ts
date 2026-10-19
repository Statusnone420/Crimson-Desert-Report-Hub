// Official Pearl Abyss screenshots that illustrate issue topics. Each file is
// listed in public/official/sources.json. An image only decorates a topic; it
// never shows the problem itself.
export type IssueArt = { src: string; width: number; height: number; position: string };

const art = (src: string, width: number, height: number, position = "center"): IssueArt => ({ src, width, height, position });
const topicArt = (name: string) => art(`/official/topics/${name}.jpg`, 1600, 900);

const INTERFACE = art("/official/interface.jpg", 1920, 1080, "48% center");
const GRAPHICS = art("/official/graphics.jpg", 1920, 1080);
const CONTENT = art("/official/content.jpg", 1920, 1080, "35% center");
const COMBAT = art("/official/combat.jpg", 1920, 1080, "46% center");
const LOCALIZATION = art("/official/localization.jpg", 1920, 1080, "40% center");
const OTHER = art("/official/other.jpg", 1920, 1080, "48% center");

export const ISSUE_ART: Record<string, readonly IssueArt[]> = {
  crash_startup: [INTERFACE, topicArt("fire-hall"), topicArt("misty-giant")],
  performance: [GRAPHICS, topicArt("sailing-ship"), topicArt("mountain-overlook")],
  graphics_visual: [topicArt("underwater-shark"), topicArt("sky-ruins"), topicArt("cathedral-ruins")],
  controls_gameplay: [CONTENT, COMBAT, topicArt("valley-rider")],
  audio: [OTHER, topicArt("market-cook"), topicArt("garden-market")],
  quest_progression: [LOCALIZATION, topicArt("notice-board"), topicArt("mechanism-puzzle")],
  other: [topicArt("forest-stream"), topicArt("red-canyon"), topicArt("flower-field")],
};

// FNV-1a: a small, stable string hash, so a topic's first choice is the same on
// every visit, on the server and in the browser.
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * Picks an image for every topic. Each topic starts at the slot its id hashes
 * to in its category's set. Older topics choose first, and a topic whose slot
 * is taken moves to the next free one. So two topics in one category never
 * share an image, and a new topic never changes the image of a topic already
 * on the board. A topic's image changes only when an older topic that wanted
 * the same slot leaves the board; keeping it then would need a stored image per
 * topic. A category with more topics than images borrows images that no topic
 * on the board uses; an image repeats only once all of them are in use, and
 * never within a category while that category has an image left.
 */
export function assignIssueArt(topics: readonly { id: string; category: string; createdAt?: string | null }[], pools: Record<string, readonly IssueArt[]> = ISSUE_ART) {
  const assigned = new Map<string, IssueArt>();
  const everyImage = [...new Set(Object.values(pools).flat())];
  // A category without a set shares the "other" set, and the rule against repeats with it.
  const groups = new Map<string, Map<string, number>>();
  for (const { id, category, createdAt } of topics) {
    const key = Object.prototype.hasOwnProperty.call(pools, category) ? category : "other";
    const created = createdAt ? Date.parse(createdAt) : Number.NaN;
    groups.set(key, (groups.get(key) ?? new Map()).set(id, Number.isNaN(created) ? Number.NEGATIVE_INFINITY : created));
  }
  const takenIn = new Map<string, Set<IssueArt>>();
  const overflow: { id: string; key: string; fallback: IssueArt }[] = [];
  // Oldest first, then by id, whatever order the board lists topics in.
  for (const key of [...groups.keys()].sort()) {
    const own = pools[key] ?? [];
    const taken = new Set<IssueArt>();
    takenIn.set(key, taken);
    const members = [...groups.get(key)!].sort(([leftId, left], [rightId, right]) => left - right || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0));
    for (const [id] of members) {
      if (own.length === 0) continue;
      const start = hash(id) % own.length;
      const preferred = own.map((_, offset) => own[(start + offset) % own.length]);
      const image = preferred.find((candidate) => !taken.has(candidate));
      if (!image) {
        overflow.push({ id, key, fallback: preferred[0] });
        continue;
      }
      taken.add(image);
      assigned.set(id, image);
    }
  }
  // Each set fills first, so a borrowed image never takes a slot its own category needs.
  const inUse = new Set(assigned.values());
  for (const { id, key, fallback } of overflow) {
    const taken = takenIn.get(key)!;
    const image = everyImage.find((candidate) => !inUse.has(candidate)) ?? everyImage.find((candidate) => !taken.has(candidate)) ?? fallback;
    inUse.add(image);
    taken.add(image);
    assigned.set(id, image);
  }
  return assigned;
}
