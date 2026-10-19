import { describe, expect, it } from "vitest";
import type { FactPack } from "@/lib/editorials/factPack";
import type { CheckerOutput, WriterOutput } from "@/lib/editorials/schemas";
import { hardSlop, numberSentences, processEdition, splitSentences } from "@/lib/editorials/validate";

const pack: FactPack = {
  version: 1,
  builtAt: "2026-10-26T14:05:00.000Z",
  gaps: [],
  metrics: { patchVersions: ["2.03.02"], latestPatch: null, playersAvg7d: null, reviewShare7d: null, twitchAvg7d: null, patternIssueIds: [] },
  deltas: { newPatchVersions: [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [] },
  facts: [
    { id: "P1", text: "Patch 2.03.02 (hotfix) official notes published Oct 24, 09:00 UTC. The notes list 2 fixes.", period: "Oct 24, 09:00 UTC", value: "2.03.02", source: { label: "Pearl Abyss patch notes 2.03.02", url: "https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=140" } },
    { id: "S1", text: "18,166 players were online on Steam at Oct 26, 14:00 UTC, 26% below the usual for a Sunday at that time.", period: "Oct 26, 14:00 UTC", value: 18166, source: { label: "Steam players online, Report Hub Observatory", url: "/observatory#updates" } },
  ],
};

// Plain filler with no numbers, banned words or AI vocabulary: enough words to clear the minimum.
const FILLER = [
  "The inventory screen held its ground all week.", "Horses kept their opinions to themselves.", "The menus opened when asked, which I honestly appreciated.",
  "Quest markers pointed in roughly the right direction.", "The weather over the northern hills stayed dramatic, as advertised.", "Nobody reported a fence winning a fight this time.",
  "I checked the patch notes twice and found them pretty tidy.", "Combat felt the same, which is a kind of news.", "The map behaved itself on most evenings.",
  "Fast travel took players where they asked to go.", "I have notes, but they are pretty short ones.", "Camp chores went on without incident.",
  "Rivers flowed downhill, which I can confirm is still the rule.", "Bandits remained easy to find and hard to like.",
  "The cooking pot kept its secrets for another week.", "Night fell on schedule over every camp in the region.",
];
const paragraph = (lead: string, ids: string[]) => ({ text: [lead, ...FILLER].join(" "), sourceIds: ids });
const STILL_HITTING = "Horses still argue with fences.";
const NOTES = "Patch 2.03.02 listed 2 fixes on Oct 24.";
const NUMBERS = "18,166 players were online on Sunday at 14:00 UTC, 26% below the usual.";

function writer(overrides: Partial<WriterOutput> = {}): WriterOutput {
  return {
    title: "Clear skies over the inventory screen",
    dek: "Player numbers dipped and a hotfix tidied up two problems.",
    sections: [
      { subhead: "What the notes claim", paragraphs: [paragraph(NOTES, ["P1"])] },
      { subhead: "The numbers", paragraphs: [paragraph(NUMBERS, ["S1"])] },
      { subhead: "What players are still hitting", paragraphs: [{ text: STILL_HITTING, sourceIds: [] }] },
    ],
    factsBox: [{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: ["P1"] }, { text: "18,166 players were online on Oct 26, 14:00 UTC.", sourceIds: ["S1"] }],
    ...overrides,
  };
}

/** A checker that supports every unit, with optional overrides by id. */
function checker(output: WriterOutput, overrides: Record<string, Partial<CheckerOutput["sentences"][number]>> = {}, drop: string[] = []): CheckerOutput {
  return {
    sentences: numberSentences(output).filter((unit) => !drop.includes(unit.id)).map((unit) => ({
      id: unit.id, supported: true, citedIds: unit.writerIds, namesPerson: false, quotesPlayer: false, bannedWords: [], slopRules: [], ...overrides[unit.id],
    })),
  };
}

function process(output: WriterOutput, overrides: Record<string, Partial<CheckerOutput["sentences"][number]>> = {}, drop: string[] = []) {
  return processEdition(output, checker(output, overrides, drop), pack);
}

describe("splitting and numbering", () => {
  it("splits sentences without breaking patch versions or times", () => {
    expect(splitSentences("Patch 2.03.02 landed. It fixed 2 things at 09:00 UTC! Good? Yes.")).toEqual(["Patch 2.03.02 landed.", "It fixed 2 things at 09:00 UTC!", "Good?", "Yes."]);
  });

  it("numbers the title, dek, body sentences and facts box", () => {
    const ids = numberSentences(writer()).map((unit) => unit.id);
    expect(ids.slice(0, 4)).toEqual(["t", "d", "h1", "b1"]);
    expect(ids).toContain("h3");
    expect(ids.at(-1)).toBe("x2");
  });
});

describe("post-processing", () => {
  it("keeps a clean, sourced edition and lists only the facts it cites", () => {
    const result = process(writer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sections.map((section) => section.subhead)).toEqual(["What the notes claim", "The numbers", "What players are still hitting"]);
    expect(result.factsBox.sources.map((source) => source.id)).toEqual(["P1", "S1"]);
    expect(result.report.wordsKept).toBeGreaterThanOrEqual(250);
  });

  it("deletes unsupported, unchecked, unsourced and off-pack sentences", () => {
    const output = writer();
    const result = process(output, { b2: { supported: false }, b3: { citedIds: ["Z9"] } }, ["b4"]);
    expect(result.ok).toBe(true);
    expect(result.report.deleted).toEqual(expect.arrayContaining([
      { id: "b2", why: ["unsupported"] }, { id: "b3", why: ["unknown_source"] }, { id: "b4", why: ["not_checked"] },
    ]));
  });

  it("deletes a sentence carrying a number no cited fact contains", () => {
    const output = writer({ sections: [
      { subhead: "The numbers", paragraphs: [paragraph("Exactly 19,000 players were online on Sunday.", ["S1"])] },
      { subhead: "What the notes claim", paragraphs: [paragraph(NOTES, ["P1"])] },
    ] });
    const result = process(output);
    expect(result.report.deleted).toContainEqual({ id: "b1", why: ["unsourced_number"] });
  });

  it("skips when a person or handle is named anywhere", () => {
    expect(process(writer(), { b5: { namesPerson: true } })).toMatchObject({ ok: false, reason: "person_named" });
    const handle = writer({ dek: "A week I owe to @somebody, apparently." });
    expect(process(handle)).toMatchObject({ ok: false, reason: "person_named" });
  });

  it("keeps cursing: the owner allows it", () => {
    const cursing = "Damn, this patch fixed some shit, but the camera is still a bitch in caves. The horse is a stubborn bastard about bridges, and it pisses me off. Fuck it, the ass-backwards menu can stay.";
    expect(hardSlop(cursing)).toEqual([]);
    const result = process(writer({ sections: [...writer().sections.slice(0, 2), { subhead: "What players are still hitting", paragraphs: [{ text: cursing, sourceIds: [] }] }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.deleted).toEqual([]);
    expect(result.sections.at(-1)).toEqual({ subhead: "What players are still hitting", paragraphs: [cursing] });
  });

  it.each([
    ["a slur", "The camera in caves is retarded."],
    ["a sexual term", "The tavern scene is weirdly horny for a patch note."],
    ["a political reference", "Patch day landed in the middle of the election."],
  ])("still deletes %s", (_label, line) => {
    expect(hardSlop(line)).toEqual(["guardrail"]);
    const result = process(writer({ sections: [...writer().sections.slice(0, 2), { subhead: "What players are still hitting", paragraphs: [{ text: `${STILL_HITTING} ${line}`, sourceIds: [] }] }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.deleted).toEqual([{ id: expect.stringMatching(/^b/), why: ["guardrail"] }]);
    expect(result.sections.at(-1)).toEqual({ subhead: "What players are still hitting", paragraphs: [STILL_HITTING] });
  });

  it("still skips an attack on a real person, whether the checker spots them or a handle names them", () => {
    const attack = "Whoever wrote these notes at Pearl Abyss should be fired.";
    const output = writer({ sections: [...writer().sections.slice(0, 2), { subhead: "What players are still hitting", paragraphs: [{ text: `${STILL_HITTING} ${attack}`, sourceIds: [] }] }] });
    const id = numberSentences(output).find((unit) => unit.text === attack)?.id ?? "missing";
    expect(process(output, { [id]: { namesPerson: true } })).toMatchObject({ ok: false, reason: "person_named" });
    expect(process(writer({ dek: "Hotfix week, and @somebody still can't write a patch note." }))).toMatchObject({ ok: false, reason: "person_named" });
  });

  it("deletes player quotes and banned words in the body, and skips when the title or dek can't be cleaned", () => {
    const result = process(writer(), { b6: { quotesPlayer: true }, b7: { bannedWords: ["pivotal"] }, b8: { slopRules: [12] } });
    expect(result.report.deleted).toEqual(expect.arrayContaining([{ id: "b6", why: ["player_quote"] }, { id: "b7", why: ["banned_word"] }, { id: "b8", why: ["checklist"] }]));
    // Hype words stop a title, "insane" included again since the Oct 19 rework.
    expect(process(writer({ title: "An insane week in Pywel" }))).toMatchObject({ ok: false, reason: "slop_check_failed" });
    expect(process(writer({ title: "A game-changer week in Pywel" }))).toMatchObject({ ok: false, reason: "slop_check_failed" });
    expect(process(writer(), { d: { bannedWords: ["testament"] } })).toMatchObject({ ok: false, reason: "slop_check_failed" });
  });

  it("removes tool artifacts and sentences with banned words found deterministically", () => {
    const output = writer({ sections: [
      { subhead: "The numbers", paragraphs: [paragraph("18,166 players were online on Sunday at 14:00 UTC [cite: S1].", ["S1"])] },
      { subhead: "What the notes claim", paragraphs: [paragraph("Patch 2.03.02 was a game-changer on Oct 24.", ["P1"])] },
    ] });
    const result = process(output);
    expect(result.report.deleted).toEqual(expect.arrayContaining([
      { id: "b1", why: expect.arrayContaining(["tool_artifact"]) },
      { id: expect.stringMatching(/^b/), why: ["banned_word"] },
    ]));
  });

  it("deletes every AI-vocabulary sentence once three appear", () => {
    const output = writer({ sections: [
      { subhead: "What the notes claim", paragraphs: [paragraph("The weather was steady and robust.", [])] },
      { subhead: "The numbers", paragraphs: [paragraph("The fix list matters, quietly.", ["P1"])] },
    ] });
    const result = process(output);
    const why = result.report.deleted.filter((entry) => entry.why.includes("ai_vocabulary")).map((entry) => entry.id);
    expect(why.length).toBe(2);
  });

  it("drops a rhetorical question opener", () => {
    const output = writer({ sections: [
      { subhead: "What the notes claim", paragraphs: [paragraph("Is anyone still riding horses?", [])] },
      { subhead: "The numbers", paragraphs: [paragraph(NUMBERS, ["S1"])] },
    ] });
    expect(process(output).report.deleted).toContainEqual({ id: "b1", why: ["question_opener"] });
  });

  it("skips a checker reply that judges any unit twice", () => {
    const output = writer();
    const verdicts = checker(output);
    // An unsupported title followed by a supported one: neither verdict can be trusted.
    const twice = { sentences: [{ ...verdicts.sentences[0], supported: false }, ...verdicts.sentences] };
    expect(processEdition(output, twice, pack)).toMatchObject({ ok: false, reason: "check_failed" });
  });

  it("skips when the checker rejects or skips the title or dek", () => {
    expect(process(writer(), { t: { supported: false } })).toMatchObject({ ok: false, reason: "check_failed" });
    expect(process(writer(), { d: { quotesPlayer: true } })).toMatchObject({ ok: false, reason: "check_failed" });
    expect(process(writer(), {}, ["t"])).toMatchObject({ ok: false, reason: "check_failed" });
    expect(process(writer(), { t: { slopRules: [11] } })).toMatchObject({ ok: false, reason: "slop_check_failed" });
  });

  it("links the facts box to the sources the checker cited, not the writer's guess", () => {
    const output = writer({ factsBox: [{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: ["S1"] }] });
    const result = process(output, { x1: { citedIds: ["P1"] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsBox.items).toEqual([{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: ["P1"] }]);
  });

  it("checks subheads too: a named person stops the edition, a rejected subhead drops its section", () => {
    expect(process(writer(), { h2: { namesPerson: true } })).toMatchObject({ ok: false, reason: "person_named" });
    const dropped = process(writer(), { h3: { slopRules: [11] } });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.sections.map((section) => section.subhead)).toEqual(["What the notes claim", "The numbers"]);
    expect(dropped.report.deleted).toContainEqual({ id: "h3", why: ["checklist"] });
    expect(process(writer(), { h1: { supported: false } })).toMatchObject({ ok: false, reason: "missing_required_section" });
  });

  it("keeps a facts-box item the writer left unsourced when the checker cites it", () => {
    const unsourced = () => writer({ factsBox: [{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: [] }] });
    const result = process(unsourced(), { x1: { citedIds: ["P1"] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsBox.items).toEqual([{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: ["P1"] }]);
    // With no citation from either, the item goes, and an empty facts box stops the edition.
    expect(process(unsourced())).toMatchObject({ ok: false, reason: "check_failed" });
  });

  it("skips an edition too long for the page to store", () => {
    const long = (lead: string, ids: string[]) => ({ text: [lead, ...FILLER, ...FILLER, ...FILLER].join(" "), sourceIds: ids });
    const output = writer({ sections: [
      { subhead: "What the notes claim", paragraphs: Array.from({ length: 6 }, () => long(NOTES, ["P1"])) },
      { subhead: "The numbers", paragraphs: Array.from({ length: 6 }, () => long(NUMBERS, ["S1"])) },
    ] });
    expect(process(output)).toMatchObject({ ok: false, reason: "too_long" });
  });

  it("skips a title of 70 characters or more", () => {
    expect(process(writer({ title: "x".repeat(69) })).ok).toBe(true);
    expect(process(writer({ title: "x".repeat(70) }))).toMatchObject({ ok: false, reason: "check_failed" });
  });

  it("skips when neither the notes nor the corroboration section survives", () => {
    const output = writer();
    const notes = numberSentences(output).filter((unit) => unit.kind === "body" && unit.section === 0).map((unit) => unit.id);
    const result = process(output, Object.fromEntries(notes.map((id) => [id, { supported: false }])));
    expect(result).toMatchObject({ ok: false, reason: "missing_required_section" });
  });

  it("takes either required section, and the old forecast shape has neither", () => {
    const corroboration = writer({ sections: [
      { subhead: "What we can corroborate", paragraphs: [paragraph(NOTES, ["P1"])] },
      { subhead: "The numbers", paragraphs: [paragraph(NUMBERS, ["S1"])] },
    ] });
    expect(process(corroboration).ok).toBe(true);
    const forecast = writer({ sections: [
      { subhead: "The forecast", paragraphs: [paragraph(NUMBERS, ["S1"])] },
      { subhead: "The patch desk", paragraphs: [paragraph(NOTES, ["P1"])] },
    ] });
    expect(process(forecast)).toMatchObject({ ok: false, reason: "missing_required_section" });
  });

  it.each([
    ["Outlook", "outlook_section"],
    ["The outlook for tonight", "outlook_section"],
    ["The numbers don't lie (but they do exaggerate)", "banned_word"],
  ])("drops a section headed %s", (subhead, why) => {
    const result = process(writer({ sections: [...writer().sections, { subhead, paragraphs: [{ text: STILL_HITTING, sourceIds: [] }] }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sections.map((section) => section.subhead)).toEqual(["What the notes claim", "The numbers", "What players are still hitting"]);
    expect(result.report.deleted).toEqual([{ id: "h4", why: [why] }]);
  });

  it.each([
    "Play tonight if the map is your thing.",
    "Should you still play this week?",
    "The numbers don't lie, but they do exaggerate.",
    "The board got 0 check-ins, which is honest at least.",
    "Zero check-ins came in this week.",
    "It's an empty board, folks.",
    "An insane week for horses.",
  ])("deletes play-tonight advice, the exaggerate line, a narrated empty board and hype: %s", (line) => {
    expect(hardSlop(line)).toEqual(["banned_word"]);
  });

  it("skips when fewer than 250 words remain", () => {
    const output = writer({ sections: [
      { subhead: "What the notes claim", paragraphs: [{ text: NOTES, sourceIds: ["P1"] }] },
      { subhead: "The numbers", paragraphs: [{ text: "18,166 players were online on Sunday at 14:00 UTC.", sourceIds: ["S1"] }] },
    ] });
    expect(process(output)).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("skips when the facts box is missing or unsourced", () => {
    expect(process(writer({ factsBox: [] }))).toMatchObject({ ok: false, reason: "check_failed" });
    expect(process(writer({ factsBox: [{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: [] }] }))).toMatchObject({ ok: false, reason: "check_failed" });
  });
});
