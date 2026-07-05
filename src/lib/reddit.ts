import type { Category } from "@/lib/constants";

const RULES: { category: Category; confidence: "medium" | "low"; patterns: RegExp[] }[] = [
  {
    category: "performance",
    confidence: "medium",
    patterns: [/\bfps\b/i, /stutter/i, /frame ?(rate|pacing|drops?|gen)/i, /performance/i, /\blag(gy|ging)?\b/i],
  },
  {
    category: "crash_startup",
    confidence: "medium",
    patterns: [/crash/i, /\bctd\b/i, /freez(e|ing)/i, /won'?t (start|launch|load)/i, /hang(s|ing)? (at|on)/i],
  },
  {
    category: "controls_gameplay",
    confidence: "medium",
    patterns: [/\bhorse\b/i, /\bmount\b/i, /controls?\b/i, /input/i, /lock(s|ed)? ?up/i, /unresponsive/i],
  },
  {
    category: "graphics_visual",
    confidence: "medium",
    patterns: [/artifact/i, /flicker/i, /texture/i, /\bfsr\b/i, /\bdlss\b/i, /ghosting/i],
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
