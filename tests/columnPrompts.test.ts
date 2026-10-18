import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readColumnGuides } from "@/lib/editorials/guides.server";
import {
  CHECKER_INSTRUCTION,
  checkerRequest,
  NOTES_INTRO,
  OPENERS_INTRO,
  styleBlock,
  trimmedParts,
  VOICE_INTRO,
  voiceBlock,
  writerRequest,
  type WriterPromptParts,
} from "@/lib/editorials/prompts";
import { numberSentences } from "@/lib/editorials/validate";
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
    expect(guides.style).toBe(file("pywelDeskStyle.md"));
    expect(guides.slop).toBe(file("avoidAiSlop.md"));
    expect(guides.style.startsWith("# The Pywel Desk: voice, style guide and comedy guardrails (v1)\n")).toBe(true);
    expect(guides.slop.startsWith("## Pre-publish checklist\n")).toBe(true);
    expect(guides.slop.match(/^\d+\. /gm)).toHaveLength(15);
  });

  it("has Statusnone write in first person, with cursing allowed and the old persona gone", () => {
    expect(guides.style).toContain("Statusnone writes this column.");
    expect(guides.style).toContain('- Byline is exactly "Statusnone."');
    expect(guides.style).toContain("- No sexual content, no slurs, ever.\n");
    expect(guides.style).not.toMatch(/\bthe Desk\b|profanity|first person singular|weather bureau/i);
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
    expect(checker.maxTokens).toBe(4000);
  });

  it("tells the checker that first person and cursing are fine, and slurs, sexual terms and politics are not", () => {
    const checker = checkerRequest({ guides, model: "claude-haiku-5-5", pack: pipelinePack(), units: numberSentences(writerOutput()), timeoutMs: 1000 });
    expect(checker.system[1].text).toBe(CHECKER_INSTRUCTION);
    expect(CHECKER_INSTRUCTION).toContain('The writer\'s own "I", "me" and "we" never count.');
    expect(CHECKER_INSTRUCTION).toContain("any slur, sexual term or reference to real-world politics");
    expect(CHECKER_INSTRUCTION).toContain("Cursing on its own is allowed; don't list it.");
    expect(CHECKER_INSTRUCTION).not.toContain("Pywel Desk");
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
