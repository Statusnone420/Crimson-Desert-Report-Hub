import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readColumnGuides } from "@/lib/editorials/guides.server";
import {
  CHECKER_INSTRUCTION,
  checkerRequest,
  factPackMessage,
  NOTES_INTRO,
  OPENERS_INTRO,
  styleBlock,
  trimmedParts,
  VOICE_INTRO,
  voiceBlock,
  WRITER_INSTRUCTION,
  writerRequest,
  type WriterPromptParts,
} from "@/lib/editorials/prompts";
import { numberSentences } from "@/lib/editorials/validate";
import { samplePack } from "./columnPackFixtures";
import { pipelinePack, writerOutput } from "./columnPipelineFixtures";

const guides = readColumnGuides();
const parts: WriterPromptParts = {
  guides,
  examples: [{ body: "First voice example.", label: "one" }, { body: "Second voice example.", label: null }],
  approved: [],
  notes: [{ rating: "down", note: "Less weather, please." }, { rating: "up", note: null }],
  openers: [{ title: "Clear skies", firstSentence: "The inventory screen held." }],
};

describe("the column's guides", () => {
  it("reads the one committed copy of the style guide and the checklist", () => {
    const directory = path.join(process.cwd(), "src", "lib", "editorials");
    const file = (name: string) => readFileSync(path.join(directory, name), "utf8").replace(/\r\n/g, "\n");
    expect(guides.style).toBe(file("hubDeskStyle.md"));
    expect(guides.slop).toBe(file("avoidAiSlop.md"));
    expect(guides.style.startsWith("# State of the Game, by Statusnone: voice, style guide and guardrails (v3, 2026-10-19)\n")).toBe(true);
    expect(guides.slop.startsWith("## Pre-publish checklist\n")).toBe(true);
    expect(guides.slop.match(/^\d+\. /gm)).toHaveLength(15);
  });

  it("makes the column a patch-and-evidence brief by Statusnone, with the forecast and outlook gone", () => {
    expect(guides.style).toContain('Statusnone, in first person ("I" / "we"). No persona, mascot, or "the Desk."');
    expect(guides.style).toContain('Byline "State of the Game, by Statusnone" only (pseudonym, never legal name).');
    expect(guides.style).toContain("Never: named people, identity/platform digs, drama, politics, slurs, sexual content,");
    for (const section of ["What the notes claim", "What we can corroborate", "What players are still hitting"]) expect(guides.style).toContain(`   - **${section}:**`);
    expect(guides.style).toContain('5. **No Outlook / "play tonight" section.**');
    expect(guides.style).not.toMatch(/\*\*(The forecast|The patch desk|Field reports|Outlook):\*\*/);
  });
});

describe("the writer and checker prompts", () => {
  it("caches [A] the style guide plus checklist and [B] the voice examples, then the uncached notes, openers and instruction", () => {
    const request = writerRequest({ ...parts, model: "claude-opus-5-5", effort: "high", pack: pipelinePack(), timeoutMs: 1000 });
    expect(request.system.map((block) => block.cache)).toEqual([true, true, false]);
    expect(request.system[0].text).toBe(styleBlock(guides));
    expect(request.system[0].text).toContain("## Pre-publish checklist");
    expect(request.system[1].text).toBe(`${VOICE_INTRO}\n\n<example>\nFirst voice example.\n</example>\n\n<example>\nSecond voice example.\n</example>\n`);
    expect(request.system[2].text).toContain(`${NOTES_INTRO}\n- Thumbs down: Less weather, please.\n- Thumbs up`);
    expect(request.system[2].text).toContain(`${OPENERS_INTRO}\n- Clear skies: The inventory screen held.`);
    expect(request.maxTokens).toBe(8000);
    expect(JSON.parse(request.user).facts.map((fact: { id: string }) => fact.id)).toEqual(["P1", "S1"]);
    expect(request.user).not.toContain("https://");
  });

  it("orders [B] by position and adds at most two approved editions after the examples", () => {
    const examples = Array.from({ length: 7 }, (_, index) => ({ body: `Example ${index + 1}`, label: null }));
    const approved = [{ title: "One", body: "Body one." }, { title: "Two", body: "Body two." }, { title: "Three", body: "Body three." }];
    const block = voiceBlock(examples, approved);
    expect(block.match(/<example>/g)).toHaveLength(5);
    expect(block.match(/<example source="approved-edition">/g)).toHaveLength(2);
    expect(block.indexOf("Example 5")).toBeLessThan(block.indexOf("One"));
    expect(block).not.toContain("Three");
    expect(voiceBlock([], [])).toContain("No examples yet");
  });

  it("gives the checker block [A] byte for byte, then its own instruction", () => {
    const writer = writerRequest({ ...parts, model: "claude-opus-5-5", effort: "high", pack: pipelinePack(), timeoutMs: 1000 });
    const checker = checkerRequest({ guides, model: "claude-haiku-5-5", pack: pipelinePack(), units: numberSentences(writerOutput()), timeoutMs: 1000 });
    expect(checker.system[0]).toEqual(writer.system[0]);
    expect(checker.system[1].cache).toBe(false);
    expect(checker.effort).toBe("high");
    expect(checker.maxTokens).toBe(16000);
  });

  it("tells the checker that first person and cursing are fine, and slurs, sexual terms and politics are not", () => {
    const checker = checkerRequest({ guides, model: "claude-haiku-5-5", pack: pipelinePack(), units: numberSentences(writerOutput()), timeoutMs: 1000 });
    expect(checker.system[1].text).toBe(CHECKER_INSTRUCTION);
    expect(CHECKER_INSTRUCTION).toContain('The writer\'s own "I", "me" and "we" never count.');
    expect(CHECKER_INSTRUCTION).toContain("any slur, sexual term or reference to real-world politics");
    expect(CHECKER_INSTRUCTION).toContain("Cursing on its own is allowed; don't list it.");
    expect(CHECKER_INSTRUCTION).not.toMatch(/Pywel Desk|Hub Desk/);
  });

  it("asks the writer for the v3 sections, with no forecast, outlook or empty-board line", () => {
    for (const subhead of ["What the notes claim", "What we can corroborate", "What players are still hitting", "The numbers"]) expect(WRITER_INSTRUCTION).toContain(`- "${subhead}": `);
    expect(WRITER_INSTRUCTION).toContain('include "What the notes claim" or "What we can corroborate"');
    expect(WRITER_INSTRUCTION).toContain("Never claim more than the fact's check. A fix whose fact has no check gets no corroboration line.");
    expect(WRITER_INSTRUCTION).toContain('Never write "Hub check", "fact pack" or "label", and never use a check\'s name as a noun ("three No Hub signal yet").');
    expect(WRITER_INSTRUCTION).toContain("every sentence has to make sense without the one before it. No rhetorical questions");
    expect(WRITER_INSTRUCTION).not.toMatch(/Confirmed label|one sighting/i);
    expect(WRITER_INSTRUCTION).toContain("One report means a single source, which can send several check-ins, so never turn it into a count.");
    expect(WRITER_INSTRUCTION).toContain("Never write about an empty issue board, zero check-ins or how many people use the Hub.");
    expect(WRITER_INSTRUCTION).toContain("Never tell readers whether to play, and write no outlook section.");
    expect(WRITER_INSTRUCTION).toContain("First person is for your reactions to the facts. Never invent things you did, saw or played.");
    expect(WRITER_INSTRUCTION).not.toMatch(/The forecast|The patch desk|exaggerate/i);
  });

  it("has the checker hold corroboration to the fact's Hub check, and flag play advice and empty-board lines", () => {
    expect(CHECKER_INSTRUCTION).toContain("A claim about what the Hub can corroborate for a listed fix is backed only when a fact it cites carries that same Hub check.");
    expect(CHECKER_INSTRUCTION).toContain("Also list any phrase that tells readers whether to play, or that points out an empty issue board, zero check-ins or how many people use the Hub.");
  });

  it("passes each fact's labels and Hub check to the models, never its URL", () => {
    const facts: { id: string; label?: string; check?: string }[] = JSON.parse(factPackMessage(samplePack())).facts;
    expect(facts.find((fact) => fact.id === "F1")).toMatchObject({ check: "No Hub signal yet" });
    expect(facts.find((fact) => fact.id === "F1")).not.toHaveProperty("label");
    expect(facts.find((fact) => fact.id === "C1")).toMatchObject({ label: "Reported" });
    expect(facts.find((fact) => fact.id === "S1")).not.toHaveProperty("check");
    expect(factPackMessage(samplePack())).not.toContain("https://");
  });

  it("trims the oldest notes and openers first, then the rotating examples", () => {
    const many: WriterPromptParts = { ...parts, notes: Array.from({ length: 10 }, (_, index) => ({ rating: null, note: `note ${index}` })), openers: parts.openers.concat(parts.openers), approved: [{ title: "A", body: "B" }] };
    expect(trimmedParts(many, 0)?.notes.map((note) => note.note)).toEqual(["note 0", "note 1", "note 2", "note 3", "note 4"]);
    expect(trimmedParts(many, 1)?.openers).toHaveLength(1);
    expect(trimmedParts(many, 2)?.approved).toEqual([]);
    expect(trimmedParts(many, 3)).toMatchObject({ notes: [], openers: [] });
    expect(trimmedParts(many, 4)).toBeNull();
  });
});
