import { vi } from "vitest";
import type { FactPack } from "@/lib/editorials/factPack";
import type { CheckerOutput, WriterOutput } from "@/lib/editorials/schemas";
import { numberSentences } from "@/lib/editorials/validate";

export const RUN_NOW = new Date("2026-10-26T14:05:00.000Z");
export const GUIDES = () => ({ style: "# Column style guide (test copy)\n", slop: "## Pre-publish checklist (test copy)\n" });

export function pipelinePack(newsworthy = true): FactPack {
  return {
    version: 1,
    builtAt: RUN_NOW.toISOString(),
    gaps: [],
    metrics: { patchVersions: ["2.03.02"], latestPatch: { version: "2.03.02", kind: "hotfix", publishedAt: "2026-10-24T09:00:00Z" }, playersAvg7d: 18000, reviewShare7d: 72, twitchAvg7d: 3000, patternIssueIds: [] },
    deltas: { newPatchVersions: newsworthy ? ["2.03.02"] : [], newUpdate: false, newPatternIssueIds: [], newVerdictIssueIds: [] },
    facts: [
      { id: "P1", text: "Patch 2.03.02 (hotfix) official notes published Oct 24, 09:00 UTC. The notes list 2 fixes.", period: "Oct 24, 09:00 UTC", value: "2.03.02", source: { label: "Pearl Abyss patch notes 2.03.02", url: "https://crimsondesert.pearlabyss.com/en-us/News/Notice/Detail?_boardNo=140" } },
      { id: "S1", text: "18,166 players were online on Steam at Oct 26, 14:00 UTC, 26% below the usual for a Sunday at that time.", period: "Oct 26, 14:00 UTC", value: 18166, source: { label: "Steam players online, Report Hub Observatory", url: "/observatory#updates" } },
    ],
  };
}

const FILLER = [
  "The inventory screen held its ground all week.", "Horses kept their opinions to themselves.", "The menus opened when asked, which I honestly appreciated.",
  "Quest markers pointed in roughly the right direction.", "The weather over the northern hills stayed dramatic, as advertised.", "Nobody reported a fence winning a fight this time.",
  "I checked the patch notes twice and found them pretty tidy.", "Combat felt the same, which is a kind of news.", "The map behaved itself on most evenings.",
  "Fast travel took players where they asked to go.", "I have notes, but they are pretty short ones.", "Camp chores went on without incident.",
  "Rivers flowed downhill, which I can confirm is still the rule.", "Bandits remained easy to find and hard to like.",
  "The cooking pot kept its secrets for another week.", "Night fell on schedule over every camp in the region.",
];

export function writerOutput(overrides: Partial<WriterOutput> = {}): WriterOutput {
  return {
    title: "Clear skies over the inventory screen",
    dek: "Player numbers dipped and a hotfix tidied up two problems.",
    sections: [
      { subhead: "What the notes claim", paragraphs: [{ text: ["Patch 2.03.02 listed 2 fixes on Oct 24.", ...FILLER].join(" "), sourceIds: ["P1"] }] },
      { subhead: "The numbers", paragraphs: [{ text: ["18,166 players were online on Sunday at 14:00 UTC, 26% below the usual.", ...FILLER].join(" "), sourceIds: ["S1"] }] },
    ],
    factsBox: [{ text: "Patch 2.03.02 lists 2 fixes.", sourceIds: ["P1"] }, { text: "18,166 players were online on Oct 26, 14:00 UTC.", sourceIds: ["S1"] }],
    ...overrides,
  };
}

export function checkerOutput(output: WriterOutput, overrides: Record<string, Partial<CheckerOutput["sentences"][number]>> = {}): CheckerOutput {
  return {
    sentences: numberSentences(output).map((unit) => ({
      id: unit.id, supported: true, citedIds: unit.writerIds, namesPerson: false, quotesPlayer: false, bannedWords: [], slopRules: [], ...overrides[unit.id],
    })),
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function messageReply(output: unknown, extra: Record<string, unknown> = {}): Response {
  return json(200, {
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 2000, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0, output_tokens: 1500 },
    ...extra,
  });
}

export type ProviderScript = {
  writer?: () => Response;
  checker?: (writer: WriterOutput) => Response;
  countTokens?: number;
};

/** A provider stand-in: routes count_tokens, writer and checker calls and records each body. */
export function providerFetch(script: ProviderScript = {}) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const output = writerOutput();
  const impl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith("/count_tokens")) return json(200, { input_tokens: script.countTokens ?? 6000 });
    const isChecker = String(body.model).includes("haiku");
    if (isChecker) return script.checker ? script.checker(output) : messageReply(checkerOutput(output));
    return script.writer ? script.writer() : messageReply(output);
  });
  const messageCalls = () => calls.filter((call) => !call.url.endsWith("/count_tokens"));
  return { impl, calls, messageCalls };
}
