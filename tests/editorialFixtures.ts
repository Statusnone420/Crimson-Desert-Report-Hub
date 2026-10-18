import type { PublicEditorialRow } from "@/lib/editorials/content";
import { sectionsToMarkdown } from "@/lib/editorials/content";

export const NOW = new Date("2026-10-26T15:00:00Z");

export const editionSections = [
  { subhead: "The forecast", paragraphs: ["Clear skies over the inventory screen. 18,166 players were online Sunday afternoon."] },
  { subhead: "The patch desk", paragraphs: ["Patch 2.03.02 fixed crashes in certain situations, which narrows it down to all of them."] },
];

export const editionFactsBox = {
  items: [
    { text: "Patch 2.03.02 lists a crash fix.", sourceIds: ["P1"] },
    { text: "18,166 players were online on Oct 25 at 15:00 UTC.", sourceIds: ["S1"] },
  ],
  sources: [
    { id: "P1", label: "Pearl Abyss patch notes 2.03.02", url: "https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=140" },
    { id: "S1", label: "Players online, Report Hub", url: "/observatory#updates" },
  ],
};

export function publicRow(overrides: Partial<PublicEditorialRow> = {}): PublicEditorialRow {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    slug: "clear-skies-over-the-inventory-screen",
    title: "Clear skies over the inventory screen",
    dek: "Players held steady and a patch fixed crashes in certain situations.",
    body_md: sectionsToMarkdown(editionSections),
    facts_box: editionFactsBox,
    status: "held",
    publish_at: "2026-10-26T14:00:00Z",
    vetoed_at: null,
    is_test: false,
    author: "The Pywel Desk",
    ...overrides,
  };
}

/** Words that would leak the model, provider or AI process into public output. */
export const PRIVATE_PROCESS_WORDS = ["claude", "anthropic", "openrouter", "opus", "sonnet", "haiku", "fable", "writer_model", "fact_pack", "check_report", "prompt", "llm"];
