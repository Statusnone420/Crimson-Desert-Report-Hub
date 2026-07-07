import type { Category } from "@/lib/constants";

// Order matters: classifySignal returns the FIRST matching rule. Specific symptom
// categories (crash/controls/graphics/audio/quest) are listed BEFORE performance so
// that a report whose real symptom is audio or quest but which merely mentions
// "performance improvements/optimizations" as the cause routes to the specific
// symptom. Performance is the LAST, broad, contextual catch-all — it must only win
// when no specific symptom category matched first.
const RULES: { category: Category; confidence: "medium" | "low"; patterns: RegExp[] }[] = [
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
      /\bvisuals?\b/i,
      /pop.?in/i,
    ],
  },
  {
    category: "audio",
    confidence: "medium",
    patterns: [
      /\baudio\b/i,
      /\bsounds?\b/i,
      /\bmusic\b/i,
      /\bvoice(?:s|-? ?over| ?line| ?acting)?\b/i,
      /\bsfx\b/i,
      /\bvolume\b/i,
      /\bno sound\b/i,
    ],
  },
  {
    category: "quest_progression",
    confidence: "medium",
    patterns: [
      /\bquests?\b/i,
      /\bmissions?\b/i,
      /\bobjectives?\b/i,
      /\bcutscenes?\b/i,
      /\bnpcs?\b/i,
      /\bsoftlock\b/i,
      /\bcan'?t (?:complete|continue|proceed|progress)\b/i,
      /\bdialogue\b/i,
    ],
  },
  {
    category: "performance",
    confidence: "medium",
    patterns: [
      /\bfps\b/i,
      /stutter/i,
      /frame ?(rate|pacing|drops?|gen)/i,
      /performance/i,
      /\blag(gy|ging)?\b/i,
      /optimi[sz](?:ation|ed|ing|es)?/i,
      /loading time/i,
      /frame ?time/i,
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
