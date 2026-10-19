import type { FactPack } from "@/lib/editorials/factPack";
import type { MessagesRequest, SystemBlock } from "@/lib/editorials/messages";
import type { CheckerModel, WriterEffort, WriterModel } from "@/lib/editorials/models";
import { CHECKER_OUTPUT_SCHEMA, WRITER_OUTPUT_SCHEMA } from "@/lib/editorials/schemas";
import type { SentenceRef } from "@/lib/editorials/validate";
import { CHECKER_EFFORT, CHECKER_MAX_TOKENS, WRITER_MAX_TOKENS } from "@/lib/editorials/config";

export type ColumnGuides = { style: string; slop: string };
export type VoiceExample = { body: string; label: string | null };
export type ApprovedEdition = { title: string; body: string };
export type StyleNote = { rating: "up" | "down" | null; note: string | null };
export type Opener = { title: string; firstSentence: string };

export const VOICE_INTRO = "Examples of the target voice. Match tone and rhythm; never reuse their facts, jokes, or wording.";
export const NOTES_INTRO = "Editor notes, newest first; follow them; hard rules win on conflict:";
export const OPENERS_INTRO = "Don't reuse these joke structures:";
export const MAX_VOICE_EXAMPLES = 5;
export const MAX_APPROVED_EXAMPLES = 2;
export const MAX_NOTES = 10;
export const MAX_OPENERS = 3;

/** Block [A]: the Hub Desk style guide, then the pre-publish checklist. The checker reuses it byte for byte. */
export function styleBlock(guides: ColumnGuides): string {
  return `${guides.style.trimEnd()}\n\n${guides.slop.trimEnd()}\n`;
}

function exampleText(text: string): string {
  return text.replace(/<\/?example[^>]*>/gi, "").trim();
}

/** Block [B]: up to five voice examples in position order, then up to two approved editions. */
export function voiceBlock(examples: readonly VoiceExample[], approved: readonly ApprovedEdition[]): string {
  const parts = [
    VOICE_INTRO,
    ...examples.slice(0, MAX_VOICE_EXAMPLES).map((example) => `<example>\n${exampleText(example.body)}\n</example>`),
    ...approved.slice(0, MAX_APPROVED_EXAMPLES).map((edition) => `<example source="approved-edition">\n${exampleText(`${edition.title}\n\n${edition.body}`)}\n</example>`),
  ];
  if (parts.length === 1) parts.push("(No examples yet. Follow the style guide.)");
  return `${parts.join("\n\n")}\n`;
}

function noteLine(note: StyleNote): string {
  const rating = note.rating === "up" ? "Thumbs up" : note.rating === "down" ? "Thumbs down" : "Note";
  return `- ${rating}${note.note ? `: ${note.note.replace(/\s+/g, " ").trim()}` : ""}`;
}

export const WRITER_INSTRUCTION = `Write this State of the Game edition from the fact pack in the user message.

- Use only facts from the pack. In sourceIds, list the ids of every fact a paragraph uses; a paragraph with no factual claim has an empty list.
- Every number, date, time and patch version you write must appear in a fact you cite. Don't round, convert or add years.
- Give each known issue the evidence and status labels its fact carries, never stronger ones. An issue with forum links only has no label: attribute it by count ("4 public posts mention it") and never call it a pattern.
- Write 4 or 5 sections with plain, sentence-case subheads from the style guide's rotation. Include "The forecast", "The patch desk" or both. Skip a section that has no data.
- The sections hold 300 to 500 words. The title is under 70 characters. The dek is one sentence.
- factsBox holds 3 to 6 plain, joke-free statements, each with the ids it rests on.
- Write every time in UTC, like "Oct 18, 16:00 UTC".
- Before you answer, run the style guide's self-check and the pre-publish checklist.`;

/** The uncached tail: editor notes, recent openers, then the instruction. */
export function writerContextBlock(notes: readonly StyleNote[], openers: readonly Opener[]): string {
  const parts: string[] = [];
  if (notes.length) parts.push([NOTES_INTRO, ...notes.slice(0, MAX_NOTES).map(noteLine)].join("\n"));
  if (openers.length) parts.push([OPENERS_INTRO, ...openers.slice(0, MAX_OPENERS).map((opener) => `- ${opener.title}: ${opener.firstSentence}`)].join("\n"));
  parts.push(WRITER_INSTRUCTION);
  return parts.join("\n\n");
}

/** The pack as the models see it: ids, statements, periods and labels. Source URLs stay with the Hub. */
export function factPackMessage(pack: FactPack): string {
  return JSON.stringify({
    builtAt: pack.builtAt,
    facts: pack.facts.map((fact) => ({
      id: fact.id,
      text: fact.text,
      period: fact.period,
      ...(fact.label ? { label: fact.label } : {}),
      ...(fact.status ? { status: fact.status } : {}),
      source: fact.source.label,
    })),
  });
}

export type WriterPromptParts = {
  guides: ColumnGuides;
  examples: VoiceExample[];
  approved: ApprovedEdition[];
  notes: StyleNote[];
  openers: Opener[];
};

export function writerRequest(input: WriterPromptParts & { model: WriterModel; effort: WriterEffort; pack: FactPack; timeoutMs: number }): MessagesRequest {
  const system: SystemBlock[] = [
    { text: styleBlock(input.guides), cache: true },
    { text: voiceBlock(input.examples, input.approved), cache: true },
    { text: writerContextBlock(input.notes, input.openers), cache: false },
  ];
  return {
    model: input.model,
    system,
    user: factPackMessage(input.pack),
    maxTokens: WRITER_MAX_TOKENS,
    effort: input.effort,
    schema: WRITER_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: input.timeoutMs,
  };
}

export const CHECKER_INSTRUCTION = `You are the fact checker for the State of the Game column. The user message holds the fact pack and the edition split into numbered units: the title (t), the dek (d), section subheads (h1, h2, ...), body sentences (b1, b2, ...) and facts-box items (x1, x2, ...). Each unit lists the ids its paragraph or item cites.

Return every unit id exactly once, with:
- supported: true when the unit makes no factual claim, or every claim in it is backed by facts in the pack. Exaggerating a fact's tone is fine; changing its substance is not.
- citedIds: the ids of the facts that back it; empty when it makes no factual claim.
- namesPerson: true when it names or identifies any real person, player, poster, creator, streamer, journalist, reviewer or staff member, or any username or handle. The writer's own "I", "me" and "we" never count.
- quotesPlayer: true when it quotes a player directly.
- bannedWords: words or phrases from the style guide's banned lists or the checklist that appear in it, and any slur, sexual term or reference to real-world politics. Cursing on its own is allowed; don't list it.
- slopRules: the numbers of the pre-publish checklist rules it breaks.

Judge every unit against the style guide and the checklist above.`;

export function checkerRequest(input: { guides: ColumnGuides; model: CheckerModel; pack: FactPack; units: SentenceRef[]; timeoutMs: number }): MessagesRequest {
  return {
    model: input.model,
    system: [
      { text: styleBlock(input.guides), cache: true },
      { text: CHECKER_INSTRUCTION, cache: false },
    ],
    user: JSON.stringify({
      factPack: JSON.parse(factPackMessage(input.pack)),
      units: input.units.map((unit) => ({ id: unit.id, text: unit.text, cites: unit.writerIds })),
    }),
    maxTokens: CHECKER_MAX_TOKENS,
    effort: CHECKER_EFFORT,
    schema: CHECKER_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: input.timeoutMs,
  };
}

/** Prompt-size guard: drop the oldest notes, openers and rotating examples first. */
export function trimmedParts(parts: WriterPromptParts, step: number): WriterPromptParts | null {
  const steps: ((value: WriterPromptParts) => WriterPromptParts)[] = [
    (value) => ({ ...value, notes: value.notes.slice(0, Math.max(0, value.notes.length - 5)) }),
    (value) => ({ ...value, openers: value.openers.slice(0, 1) }),
    (value) => ({ ...value, approved: [] }),
    (value) => ({ ...value, notes: [], openers: [] }),
  ];
  if (step >= steps.length) return null;
  return steps.slice(0, step + 1).reduce((value, apply) => apply(value), parts);
}
