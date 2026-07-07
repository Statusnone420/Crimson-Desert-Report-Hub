import type { Category } from "@/lib/constants";

const RULES: { category: Category; confidence: "medium" | "low"; patterns: RegExp[] }[] = [
  {
    category: "performance",
    confidence: "medium",
    patterns: [
      /\bfps\b/i,
      /stutter/i,
      /frame ?(rate|pacing|drops?|gen)/i,
      /performance/i,
      /\blag(gy|ging)?\b/i,
      /optimi[sz]ation/i,
      /loading time/i,
      /frame ?time/i,
    ],
  },
  {
    category: "crash_startup",
    confidence: "medium",
    patterns: [
      /crash/i,
      /\bctd\b/i,
      /freez(e|ing)/i,
      /won'?t (start|launch|load)/i,
      /hang(s|ing)? (at|on)/i,
      /black ?screen/i,
      /infinite (?:load|loading)/i,
      /stuck (?:on|at) (?:load|loading|boot)/i,
    ],
  },
  {
    category: "controls_gameplay",
    confidence: "medium",
    patterns: [/\bhorse\b/i, /\bmount\b/i, /controls?\b/i, /input/i, /lock(s|ed)? ?up/i, /unresponsive/i],
  },
  {
    category: "graphics_visual",
    confidence: "medium",
    patterns: [
      /artifact/i,
      /flicker/i,
      /texture/i,
      /\bfsr\b/i,
      /\bdlss\b/i,
      /ghosting/i,
      /rendering/i,
      /\blighting\b/i,
      /shadow/i,
      /\bvisual\b/i,
      /pop.?in/i,
    ],
  },
  {
    category: "audio",
    confidence: "medium",
    patterns: [
      /\baudio\b/i,
      /\bsound\b/i,
      /\bmusic\b/i,
      /\bvoice ?(?:over|line|acting)?\b/i,
      /\bsfx\b/i,
      /\bmuted?\b/i,
      /\bvolume\b/i,
      /\bno sound\b/i,
    ],
  },
  {
    category: "quest_progression",
    confidence: "medium",
    patterns: [
      /\bquest\b/i,
      /\bmission\b/i,
      /\bobjective\b/i,
      /\bcutscene\b/i,
      /\bnpc\b/i,
      /\bsoftlock\b/i,
      /\bcan'?t (?:complete|continue|proceed|progress)\b/i,
      /\bdialogue\b/i,
    ],
  },
];

export function classifySignal(text: string): { category: Category; confidence: "low" | "medium" } {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { category: rule.category, confidence: rule.confidence };
    }
  }
  return { category: "other", confidence: "low" };
}

export function summarize(title: string, body: string): string {
  const flatTitle = title.replace(/\s+/g, " ").trim() || "Untitled Reddit post";
  const flat = body.trim() ? `${flatTitle} (body retained for 48h moderator review)` : flatTitle;
  return flat.length <= 280 ? flat : `${flat.slice(0, 277)}...`;
}
