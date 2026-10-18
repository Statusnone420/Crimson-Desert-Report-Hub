import type { EditionSection, EditionSource, FactsBox } from "@/lib/editorials/content";
import type { Fact, FactPack } from "@/lib/editorials/factPack";
import type { CheckerOutput, CheckerVerdict, WriterOutput } from "@/lib/editorials/schemas";

export type SkipReason =
  | "paused" | "below_threshold" | "min_gap" | "budget" | "prompt_too_large" | "provider_unavailable"
  | "model_not_allowed" | "writer_failed" | "check_failed" | "person_named" | "too_short"
  | "missing_required_section" | "slop_check_failed" | "no_time";

export const MIN_WORDS = 250;
export const MAX_TITLE_CHARACTERS = 69;
export const MAX_FACTS_BOX_ITEMS = 6;
const MAX_FACT_CHARACTERS = 400;
const REQUIRED_SECTIONS = ["the forecast", "the patch desk"];

/** One numbered unit the checker judges: the title, the dek, a subhead, a body sentence or a facts-box item. */
export type SentenceRef = {
  id: string;
  kind: "title" | "dek" | "subhead" | "body" | "fact";
  section?: number;
  paragraph?: number;
  text: string;
  /** The ids the writer cited for the paragraph or facts-box item this unit belongs to. */
  writerIds: string[];
};

/** Splits on sentence-ending punctuation followed by a space and a capital, digit or opening quote. */
export function splitSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/).map((sentence) => sentence.trim()).filter(Boolean);
}

export function numberSentences(output: WriterOutput): SentenceRef[] {
  const refs: SentenceRef[] = [
    { id: "t", kind: "title", text: output.title, writerIds: [] },
    { id: "d", kind: "dek", text: output.dek, writerIds: [] },
  ];
  let body = 0;
  output.sections.forEach((section, sectionIndex) => {
    refs.push({ id: `h${sectionIndex + 1}`, kind: "subhead", section: sectionIndex, text: section.subhead, writerIds: [] });
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      for (const sentence of splitSentences(paragraph.text)) {
        refs.push({ id: `b${++body}`, kind: "body", section: sectionIndex, paragraph: paragraphIndex, text: sentence, writerIds: paragraph.sourceIds });
      }
    });
  });
  output.factsBox.forEach((item, index) => refs.push({ id: `x${index + 1}`, kind: "fact", text: item.text.trim(), writerIds: item.sourceIds }));
  return refs;
}

// Deterministic checks. These back up the checker; they never replace it.
const HANDLE = /(^|[\s(])@[A-Za-z0-9_]{2,}|\bu\/[A-Za-z0-9_-]{3,}/;
const TOOL_ARTIFACT = /oaicite|\[cite:|utm_source=|grok_card|\bXX\b|[[\]{}]|\*\*|__|`|^#|\bTODO\b|\bTBD\b|lorem ipsum|as an ai\b|language model/i;
const HARD_BANNED = new RegExp([
  "\\binsane\\b", "game[- ]changer", "let[’']s dive in", "\\bdive in\\b", "roller ?coaster", "\\blol\\b", "\\bdelv(e|es|ed|ing)\\b",
  "\\btestament\\b", "\\bpivotal\\b", "\\btapestry\\b", "marks a shift", "\\bvibrant\\b", "\\bgroundbreaking\\b", "\\bboasts?\\b",
  "\\brenowned\\b", "\\bnestled\\b", "\\bin conclusion\\b", "\\bin summary\\b", "despite these challenges", "only time will tell",
  "it[’']s worth noting", "it is worth noting", "here[’']s what you need to know", "based on available information",
  "details are limited", "players are saying", "many players", "many fans", "experts say",
  "\\bfuck", "\\bshit", "\\bbitch", "\\basshole", "\\bbastard", "\\bcunt", "\\bpiss",
].join("|"), "i");
const EMOJI = /\p{Extended_Pictographic}/u;
const HASHTAG = /(^|\s)#[A-Za-z]\w*/;
const AI_VOCABULARY = /\b(crucial|robust|seamless(ly)?|showcas\w*|landscapes?|underscor\w*|highlight(s|ed|ing)?|foster\w*|leverag\w*|enhanc\w*|multifaceted|matters|quietly|stead(y|ily)|dependabl\w*|practical(ly)?)\b/gi;

export function hardSlop(text: string): string[] {
  const reasons: string[] = [];
  if (TOOL_ARTIFACT.test(text)) reasons.push("tool_artifact");
  if (HARD_BANNED.test(text)) reasons.push("banned_word");
  if (EMOJI.test(text)) reasons.push("emoji");
  if (HASHTAG.test(text)) reasons.push("hashtag");
  return reasons;
}

function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((token) => (/^\d{1,3}(,\d{3})+$/.test(token) ? token.replace(/,/g, "") : token));
}

function factTokens(facts: Fact[]): Set<string> {
  return new Set(facts.flatMap((fact) => [...numberTokens(fact.text), ...numberTokens(fact.period), ...numberTokens(String(fact.value ?? ""))]));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export type CheckReport = {
  units: number;
  deleted: { id: string; why: string[] }[];
  wordsKept: number;
  skip: SkipReason | null;
};

export type ProcessedEdition =
  | { ok: true; title: string; dek: string; sections: EditionSection[]; factsBox: FactsBox; report: CheckReport }
  | { ok: false; reason: SkipReason; report: CheckReport };

/**
 * Deterministic post-processing. Deletes sentences the checker found unsupported, that
 * quote a player, hit a banned word or checklist rule, cite an id outside the pack, or
 * carry a number no cited fact contains. Then skips when a person is named, the title or
 * dek can't be cleaned, the title runs 70 characters or more, both required sections are
 * gone, fewer than 250 words remain, or the facts box is missing or unsourced.
 */
export function processEdition(output: WriterOutput, checker: CheckerOutput, pack: FactPack): ProcessedEdition {
  const refs = numberSentences(output);
  const verdicts = new Map<string, CheckerVerdict>(checker.sentences.map((verdict) => [verdict.id, verdict]));
  const factsById = new Map(pack.facts.map((fact) => [fact.id, fact]));
  const deleted = new Map<string, string[]>();
  const report = (skip: SkipReason | null, wordsKept = 0): CheckReport => ({
    units: refs.length,
    deleted: [...deleted.entries()].map(([id, why]) => ({ id, why })),
    wordsKept,
    skip,
  });
  const fail = (reason: SkipReason, wordsKept = 0): ProcessedEdition => ({ ok: false, reason, report: report(reason, wordsKept) });

  // Any named person or handle, anywhere, stops the edition.
  if (refs.some((ref) => verdicts.get(ref.id)?.namesPerson || HANDLE.test(ref.text))) return fail("person_named");

  // The title and dek can't be deleted, so any rejection there stops the edition.
  for (const ref of refs.filter((item) => item.kind === "title" || item.kind === "dek")) {
    const verdict = verdicts.get(ref.id);
    if (!verdict || !verdict.supported || verdict.quotesPlayer) return fail("check_failed");
    if (hardSlop(ref.text).length || verdict.bannedWords.length || verdict.slopRules.length) return fail("slop_check_failed");
  }

  const effectiveIds = new Map<string, string[]>();
  for (const ref of refs.filter((item) => item.kind === "body" || item.kind === "fact")) {
    const verdict = verdicts.get(ref.id);
    // The checker's citations win; the writer's stand only where the checker cites none.
    const ids = verdict?.citedIds.length ? [...new Set(verdict.citedIds)] : ref.writerIds;
    effectiveIds.set(ref.id, ids);
    const why: string[] = [];
    if (!verdict) why.push("not_checked");
    else {
      if (!verdict.supported) why.push("unsupported");
      if (verdict.quotesPlayer) why.push("player_quote");
      if (verdict.bannedWords.length) why.push("banned_word");
      if (verdict.slopRules.length) why.push("checklist");
    }
    why.push(...hardSlop(ref.text));
    if (ids.some((id) => !factsById.has(id))) why.push("unknown_source");
    else {
      const tokens = factTokens(ids.map((id) => factsById.get(id)!));
      if (numberTokens(ref.text).some((token) => !tokens.has(token))) why.push("unsourced_number");
    }
    if (ref.kind === "fact" && !ids.length) why.push("unsourced_fact");
    if (ref.kind === "fact" && ref.text.length > MAX_FACT_CHARACTERS) why.push("too_long");
    if (why.length) deleted.set(ref.id, why);
  }

  // A rhetorical question never opens the column.
  const firstBody = refs.find((ref) => ref.kind === "body");
  if (firstBody && firstBody.text.trim().endsWith("?") && !deleted.has(firstBody.id)) deleted.set(firstBody.id, ["question_opener"]);

  // Three or more AI-vocabulary words: the sentences that use them go.
  const kept = () => refs.filter((ref) => (ref.kind === "body" || ref.kind === "fact") && !deleted.has(ref.id));
  const vocabulary = kept().reduce((total, ref) => total + (ref.text.match(AI_VOCABULARY)?.length ?? 0), 0);
  if (vocabulary >= 3) {
    for (const ref of kept()) if (ref.text.match(AI_VOCABULARY)) deleted.set(ref.id, ["ai_vocabulary"]);
  }

  const title = output.title.trim();
  if (title.length > MAX_TITLE_CHARACTERS) return fail("check_failed");

  // A subhead can't be deleted on its own: a rejected one takes its section with it.
  for (const ref of refs.filter((item) => item.kind === "subhead")) {
    const verdict = verdicts.get(ref.id);
    const why = [
      ...(!verdict ? ["not_checked"] : []),
      ...(verdict && !verdict.supported ? ["unsupported"] : []),
      ...(verdict?.quotesPlayer ? ["player_quote"] : []),
      ...(verdict?.bannedWords.length ? ["banned_word"] : []),
      ...(verdict?.slopRules.length ? ["checklist"] : []),
      ...hardSlop(ref.text),
    ];
    if (why.length) deleted.set(ref.id, why);
  }

  const sections: EditionSection[] = [];
  output.sections.forEach((section, sectionIndex) => {
    if (deleted.has(`h${sectionIndex + 1}`)) return;
    const paragraphs = section.paragraphs
      .map((_, paragraphIndex) => kept().filter((ref) => ref.kind === "body" && ref.section === sectionIndex && ref.paragraph === paragraphIndex).map((ref) => ref.text).join(" "))
      .filter(Boolean);
    if (paragraphs.length) sections.push({ subhead: section.subhead.trim(), paragraphs });
  });
  const words = sections.reduce((total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0), 0);
  if (!sections.some((section) => REQUIRED_SECTIONS.some((required) => section.subhead.toLowerCase().startsWith(required)))) {
    return fail("missing_required_section", words);
  }
  if (words < MIN_WORDS) return fail("too_short", words);

  const items = kept().filter((ref) => ref.kind === "fact").slice(0, MAX_FACTS_BOX_ITEMS).map((ref) => ({ text: ref.text, sourceIds: effectiveIds.get(ref.id) ?? [] }));
  if (!items.length || output.factsBox.some((item) => !item.sourceIds.length)) return fail("check_failed", words);

  const keptFacts = new Set(items.map((item) => item.text));
  const citedIds = new Set(kept().filter((ref) => ref.kind === "body" || keptFacts.has(ref.text)).flatMap((ref) => effectiveIds.get(ref.id) ?? []));
  const sources: EditionSource[] = pack.facts
    .filter((fact) => citedIds.has(fact.id))
    .map((fact) => ({ id: fact.id, label: fact.source.label, url: fact.source.url }));
  return {
    ok: true,
    title,
    dek: output.dek.trim(),
    sections,
    factsBox: { items, sources },
    report: report(null, words),
  };
}
