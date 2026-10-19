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

// FNV-1a: a small, stable string hash, so a topic gets the same image on every
// visit and on the server and client alike.
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * Picks an image for every topic. A topic starts at the slot its id hashes to
 * in its category's set and takes the next free one if that is taken, so two
 * topics in one category never share an image. A category with more topics
 * than images borrows unused images from the other categories before any repeat.
 */
export function assignIssueArt(topics: readonly { id: string; category: string }[], pools: Record<string, readonly IssueArt[]> = ISSUE_ART) {
  const assigned = new Map<string, IssueArt>();
  const everyImage = [...new Set(Object.values(pools).flat())];
  const categories = [...new Set(topics.map((topic) => topic.category))];
  for (const category of categories) {
    const own = pools[category] ?? pools.other ?? [];
    const borrowed = everyImage.filter((image) => !own.includes(image));
    const taken = new Set<IssueArt>();
    // Sorting makes the result independent of the order the board lists topics in.
    const members = [...new Set(topics.filter((topic) => topic.category === category).map((topic) => topic.id))].sort();
    for (const id of members) {
      if (own.length === 0) break;
      const start = hash(id) % own.length;
      const preferred = own.map((_, offset) => own[(start + offset) % own.length]);
      const image = [...preferred, ...borrowed].find((candidate) => !taken.has(candidate)) ?? preferred[0];
      taken.add(image);
      assigned.set(id, image);
    }
  }
  return assigned;
}
