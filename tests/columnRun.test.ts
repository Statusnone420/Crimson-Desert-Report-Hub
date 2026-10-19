import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactPack } from "@/lib/editorials/factPack";

const mocks = vi.hoisted(() => ({ pack: vi.fn<() => Promise<FactPack>>() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/editorials/factPack.server", () => ({ readFactPack: mocks.pack }));

import { budgetCoversBothCalls } from "@/lib/editorials/budgetGate.server";
import { CHECKER_MAX_TOKENS, WRITER_MAX_TOKENS } from "@/lib/editorials/config";
import { sectionsToMarkdown } from "@/lib/editorials/content";
import { PROMPT_TOKEN_LIMIT } from "@/lib/editorials/generate.server";
import { buildPreviewAtomXml } from "@/lib/editorials/previewFeed";
import { worstCaseCost } from "@/lib/editorials/pricing";
import { runColumn } from "@/lib/editorials/run.server";
import { ColumnNotSetUpError } from "@/lib/editorials/settings.server";
import { readPreviewEditions, readSitemapEditions, readVisibleEditions } from "@/lib/editorials/store.server";
import { createFakeDb, markColumnTablesMissing, type FakeDb } from "./columnFakeDb";
import { checkerOutput, GUIDES, json, messageReply, pipelinePack, providerFetch, RUN_NOW, writerOutput } from "./columnPipelineFixtures";

const HOUR = 3_600_000;
let db: FakeDb;

function settings(value: Record<string, unknown>) {
  db.tables.automation_settings.push({ key: "column", value, updated_at: RUN_NOW.toISOString() });
}

function run(fetchImpl: typeof fetch, options: { now?: Date; deadlineMs?: number } = {}) {
  const now = options.now ?? RUN_NOW;
  return runColumn({ now, deadlineMs: options.deadlineMs ?? now.getTime() + 280_000, client: db.client, guides: GUIDES, clock: () => now.getTime(), fetchImpl });
}

function editorials() {
  return db.tables.editorials;
}

beforeEach(() => {
  db = createFakeDb({}, () => RUN_NOW);
  mocks.pack.mockResolvedValue(pipelinePack());
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-column");
  vi.stubEnv("COLUMN_OPENROUTER_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "scanner-key-must-not-be-used");
});
afterEach(() => vi.unstubAllEnvs());

describe("one wake of the column", () => {
  it("writes an approve-first edition: held with no publish time, both calls settled in the column ledger", async () => {
    const provider = providerFetch();
    expect(await run(provider.impl)).toEqual({ status: "held", slot: "2026-W44:mon", awaitingApproval: true });
    expect(editorials()).toHaveLength(1);
    expect(editorials()[0]).toMatchObject({ slot_key: "2026-W44:mon", status: "held", publish_at: null, slug: "clear-skies-over-the-inventory-screen", writer_model: "claude-opus-5-5", writer_effort: "high", relevance_score: 2, hold_hours: 24, skip_reason: null });
    expect(db.tables.editorial_ai_spend.map((row) => [row.operation, row.provider, row.cost_state])).toEqual([["writer", "anthropic", "settled"], ["checker", "anthropic", "settled"]]);
    expect(provider.messageCalls().map((call) => call.body.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    // The checker reuses block [A] byte for byte.
    const [writerCall, checkerCall] = provider.messageCalls();
    expect((checkerCall.body.system as { text: string }[])[0]).toEqual((writerCall.body.system as { text: string }[])[0]);
  });

  it("holds an edition for its hold time once approve-first is done", async () => {
    settings({ approveFirstRemaining: 0, holdHours: 12 });
    expect(await run(providerFetch().impl)).toMatchObject({ status: "held", awaitingApproval: false });
    expect(editorials()[0].publish_at).toBe(new Date(RUN_NOW.getTime() + 12 * HOUR).toISOString());
  });

  it("clears a used one-shot override, and only after a real edition", async () => {
    settings({ nextEditionModel: "claude-sonnet-5-5" });
    const provider = providerFetch();
    await run(provider.impl);
    expect(provider.messageCalls()[0].body.model).toBe("claude-sonnet-5-5");
    expect((db.tables.automation_settings.find((row) => row.key === "column")!.value as Record<string, unknown>).nextEditionModel).toBeNull();

    db = createFakeDb({}, () => RUN_NOW);
    settings({ nextEditionModel: "claude-sonnet-5-5" });
    await run(providerFetch({ writer: () => json(401, { error: { message: "invalid x-api-key" } }) }).impl);
    expect((db.tables.automation_settings.find((row) => row.key === "column")!.value as Record<string, unknown>).nextEditionModel).toBe("claude-sonnet-5-5");
  });

  it.each([
    ["paused", () => settings({ paused: true })],
    ["min_gap", () => { db.tables.editorials.push({ id: "old", slot_key: "2026-W43:mon", status: "held", is_test: false, slug: "old", title: "Old", body_md: "## The forecast\n\nOld.", created_at: new Date(RUN_NOW.getTime() - 10 * HOUR).toISOString(), publish_at: null }); }],
    ["budget", () => { db.tables.editorial_ai_spend.push({ id: "spent", month: "2026-10", operation: "writer", provider: "anthropic", model: "claude-opus-5-5", reserved_usd: 14.9, settled_usd: 14.9, cost_state: "settled", created_at: RUN_NOW.toISOString() }); }],
    ["below_threshold", () => mocks.pack.mockResolvedValue(pipelinePack(false))],
    ["provider_unavailable", () => vi.stubEnv("ANTHROPIC_API_KEY", "")],
    ["model_not_allowed", () => settings({ nextEditionModel: "gpt-5" })],
  ])("skips silently with %s before any paid call", async (reason, arrange) => {
    arrange();
    const provider = providerFetch();
    expect(await run(provider.impl)).toEqual({ status: "skipped", slot: "2026-W44:mon", reason });
    expect(provider.impl).not.toHaveBeenCalled();
    expect(editorials().filter((row) => row.slot_key === "2026-W44:mon")).toEqual([expect.objectContaining({ status: "skipped", skip_reason: reason })]);
    expect(db.tables.editorial_ai_spend.filter((row) => row.id !== "spent")).toEqual([]);
  });

  it("stores the fact pack and score on a below-threshold skip", async () => {
    mocks.pack.mockResolvedValue(pipelinePack(false));
    await run(providerFetch().impl);
    expect(editorials()[0]).toMatchObject({ skip_reason: "below_threshold", relevance_score: 0, fact_pack: expect.objectContaining({ version: 1 }) });
  });

  it("uses only the column's OpenRouter key when OpenRouter is selected", async () => {
    settings({ provider: "openrouter" });
    const none = providerFetch();
    expect(await run(none.impl)).toMatchObject({ status: "skipped", reason: "provider_unavailable" });
    expect(none.impl).not.toHaveBeenCalled();

    db = createFakeDb({}, () => RUN_NOW);
    settings({ provider: "openrouter" });
    vi.stubEnv("COLUMN_OPENROUTER_API_KEY", "or-column-key");
    const provider = providerFetch({ writer: () => messageReply(writerOutput(), { usage: { input_tokens: 1, output_tokens: 1, cost: 0.12 } }) });
    expect(await run(provider.impl)).toMatchObject({ status: "held" });
    expect(provider.calls.every((call) => call.url.startsWith("https://openrouter.ai/"))).toBe(true);
    expect(provider.calls.map((call) => call.headers.authorization)).toEqual(["Bearer or-column-key", "Bearer or-column-key"]);
    expect(db.tables.editorial_ai_spend[0]).toMatchObject({ provider: "openrouter", cost_state: "settled", settled_usd: 0.12 });
  });

  it.each([
    ["a refused key", () => json(401, { error: { type: "authentication_error", message: "invalid x-api-key" } }), "provider_unavailable"],
    ["a forbidden key", () => json(403, { error: { message: "forbidden" } }), "provider_unavailable"],
    ["a low credit balance", () => json(400, { error: { message: "Your credit balance is too low to access the Anthropic API." } }), "provider_unavailable"],
    ["a refusal", () => messageReply({}, { stop_reason: "refusal" }), "writer_failed"],
    ["a malformed reply", () => json(200, { content: [{ type: "text", text: "not json" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), "writer_failed"],
  ])("records %s from the writer as %s", async (_label, writer, reason) => {
    const provider = providerFetch({ writer });
    expect(await run(provider.impl)).toEqual({ status: "skipped", slot: "2026-W44:mon", reason });
    expect(editorials()).toEqual([expect.objectContaining({ status: "skipped", skip_reason: reason })]);
    expect(provider.messageCalls()).toHaveLength(1);
  });

  it("settles a rejected request at $0, not at its reservation", async () => {
    await run(providerFetch({ writer: () => json(401, { error: { message: "invalid x-api-key" } }) }).impl);
    expect(db.tables.editorial_ai_spend).toEqual([expect.objectContaining({ operation: "writer", cost_state: "settled", settled_usd: 0 })]);
    expect(Number(db.tables.editorial_ai_spend[0].reserved_usd)).toBeGreaterThan(0);
  });

  it.each([
    ["a named person", (output: ReturnType<typeof writerOutput>) => messageReply(checkerOutput(output, { b3: { namesPerson: true } })), "person_named"],
    ["an unreadable verdict", () => json(200, { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), "check_failed"],
    ["a checker outage", () => json(503, { error: { message: "unavailable" } }), "provider_unavailable"],
    ["too few supported words", (output: ReturnType<typeof writerOutput>) => messageReply({ sentences: checkerOutput(output).sentences.map((unit) => (unit.id.startsWith("b") && unit.id !== "b1" ? { ...unit, supported: false } : unit)) }), "too_short"],
  ])("records %s from the checker", async (_label, checker, reason) => {
    expect(await run(providerFetch({ checker }).impl)).toMatchObject({ status: "skipped", reason });
  });

  it("keeps the writer's unchecked draft on the skip when the checker hits its token limit, and never shows it", async () => {
    const truncated = () => json(200, { content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"sentences":[{"id":"t","supported":tr' }], stop_reason: "max_tokens", usage: { input_tokens: 6000, output_tokens: 16000 } });
    const provider = providerFetch({ checker: truncated });
    expect(await run(provider.impl)).toEqual({ status: "skipped", slot: "2026-W44:mon", reason: "check_failed" });
    expect(provider.messageCalls().map((call) => [call.body.model, call.body.max_tokens])).toEqual([["claude-opus-5-5", 8000], ["claude-haiku-5-5", 16000]]);
    expect(db.tables.editorial_ai_spend.map((row) => [row.operation, row.cost_state])).toEqual([["writer", "settled"], ["checker", "settled"]]);

    const output = writerOutput();
    expect(editorials()).toEqual([expect.objectContaining({
      slot_key: "2026-W44:mon", status: "skipped", skip_reason: "check_failed", slug: null, publish_at: null,
      title: output.title, dek: output.dek,
      body_md: sectionsToMarkdown(output.sections.map((section) => ({ subhead: section.subhead, paragraphs: section.paragraphs.map((paragraph) => paragraph.text) }))),
      check_report: expect.objectContaining({ note: "max_tokens", post: null, checker: expect.objectContaining({ model: "claude-haiku-5-5" }) }),
    })]);

    // Still a skip: off the public pages, feeds and sitemap, long after any hold would end.
    const later = new Date(RUN_NOW.getTime() + 30 * 86_400_000);
    expect(await readVisibleEditions(db.client, later)).toEqual([]);
    expect(await readSitemapEditions(db.client, later)).toEqual([]);
    // The private preview feed names the slot and why it skipped, never the unchecked text.
    const preview = buildPreviewAtomXml(await readPreviewEditions(db.client, RUN_NOW), RUN_NOW);
    expect(preview).toContain("[Skipped: check_failed (max_tokens)] Slot 2026-W44:mon");
    expect(preview).not.toContain(output.title);
    expect(preview).not.toContain("held its ground");
  });

  it("keeps no draft when it would not fit the row", async () => {
    const paragraphs = Array.from({ length: 8 }, () => ({ text: "Rain again. ".repeat(80).trim(), sourceIds: ["S1"] }));
    const long = writerOutput({ sections: ["The forecast", "The patch desk", "The long view"].map((subhead) => ({ subhead, paragraphs })) });
    const truncated = () => json(200, { content: [{ type: "text", text: "{" }], stop_reason: "max_tokens", usage: { input_tokens: 6000, output_tokens: 16000 } });
    expect(await run(providerFetch({ writer: () => messageReply(long), checker: truncated }).impl)).toMatchObject({ status: "skipped", reason: "check_failed" });
    expect(editorials()[0]).toMatchObject({ status: "skipped", skip_reason: "check_failed", check_report: expect.objectContaining({ note: "max_tokens" }) });
    expect([editorials()[0].title, editorials()[0].dek, editorials()[0].body_md].map((value) => value ?? null)).toEqual([null, null, null]);
  });

  it.each([
    ["an unreadable verdict", () => json(200, { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })],
    ["a refusal", () => messageReply({}, { stop_reason: "refusal" })],
    ["a timeout", () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }],
  ])("keeps no draft when the checker stops on %s", async (_label, checker) => {
    expect(await run(providerFetch({ checker }).impl)).toMatchObject({ status: "skipped", reason: "check_failed" });
    expect([editorials()[0].title, editorials()[0].body_md].map((value) => value ?? null)).toEqual([null, null]);
  });

  it("refuses a prompt that stays over 90k tokens after trimming, without a paid call", async () => {
    const provider = providerFetch({ countTokens: 95_000 });
    expect(await run(provider.impl)).toMatchObject({ status: "skipped", reason: "prompt_too_large" });
    expect(provider.messageCalls()).toEqual([]);
  });

  it("checks the budget again with the measured prompt, and skips before any paid call when both calls no longer fit", async () => {
    // $14.535 of $15 spent: the early check with a typical prompt passes, and the writer
    // alone would still fit, but not the writer and the checker at a measured 60k tokens.
    db.tables.editorial_ai_spend.push({ id: "spent", month: "2026-10", operation: "writer", provider: "anthropic", model: "claude-opus-5-5", reserved_usd: 14.535, settled_usd: 14.535, cost_state: "settled", created_at: RUN_NOW.toISOString() });
    const provider = providerFetch({ countTokens: 60_000 });
    expect(await run(provider.impl)).toEqual({ status: "skipped", slot: "2026-W44:mon", reason: "budget" });
    expect(provider.messageCalls()).toEqual([]);
    expect(db.tables.editorial_ai_spend.map((row) => row.id)).toEqual(["spent"]);
  });

  it("counts both calls at the measured prompt, the checker at its full output allowance", async () => {
    const both = worstCaseCost("claude-opus-5-5", 60_000, WRITER_MAX_TOKENS) + worstCaseCost("claude-haiku-5-5", 60_000 + 2 * WRITER_MAX_TOKENS, CHECKER_MAX_TOKENS);
    const fits = (spent: number) => {
      const ledger = createFakeDb({ editorial_ai_spend: [{ id: "spent", month: "2026-10", reserved_usd: spent, settled_usd: spent, cost_state: "settled" }] }, () => RUN_NOW);
      return budgetCoversBothCalls(ledger.client, RUN_NOW, { writerModel: "claude-opus-5-5", checkerModel: "claude-haiku-5-5", promptTokens: 60_000, monthlyCapSetting: null });
    };
    expect(await fits(15 - both - 0.001)).toBe(true);
    expect(await fits(15 - both + 0.001)).toBe(false);
    // Even at the largest prompt, billed at Haiku's long-prompt rates, the checker stays far under the $1 request cap.
    expect(worstCaseCost("claude-haiku-5-5", PROMPT_TOKEN_LIMIT + 2 * WRITER_MAX_TOKENS, CHECKER_MAX_TOKENS)).toBeLessThan(0.25);
  });

  it("defers when too little time is left after the scan, and records no_time on the window's last wake", async () => {
    const provider = providerFetch();
    expect(await run(provider.impl, { deadlineMs: RUN_NOW.getTime() + 60_000 })).toEqual({ status: "idle", reason: "deferred" });
    expect(editorials()).toEqual([]);
    const lastWake = new Date(Date.UTC(2026, 9, 26, 19, 5));
    expect(await run(provider.impl, { now: lastWake, deadlineMs: lastWake.getTime() + 60_000 })).toMatchObject({ status: "skipped", reason: "no_time" });
    expect(provider.impl).not.toHaveBeenCalled();
  });

  it("measures each call's time again after token counting, so a slow count never runs past the deadline", async () => {
    // A slow count before the writer: no paid call starts, and the slot records no_time.
    let clockMs = RUN_NOW.getTime();
    const provider = providerFetch();
    const slowCounts = (delays: number[]): typeof fetch => async (input, init) => {
      if (String(input).endsWith("/count_tokens")) clockMs += delays.shift() ?? 0;
      return provider.impl(input, init);
    };
    const run = (fetchImpl: typeof fetch) => runColumn({ now: RUN_NOW, deadlineMs: RUN_NOW.getTime() + 280_000, client: db.client, guides: GUIDES, clock: () => clockMs, fetchImpl });
    expect(await run(slowCounts([180_000]))).toEqual({ status: "skipped", slot: "2026-W44:mon", reason: "no_time" });
    expect(provider.messageCalls()).toEqual([]);
    expect(db.tables.editorial_ai_spend).toEqual([]);

    // A slow count before the checker: the writer ran, and the checker never starts.
    db = createFakeDb({}, () => RUN_NOW);
    clockMs = RUN_NOW.getTime();
    expect(await run(slowCounts([0, 265_000]))).toEqual({ status: "skipped", slot: "2026-W44:mon", reason: "check_failed" });
    expect(provider.messageCalls().map((call) => call.body.model)).toEqual(["claude-opus-5-5"]);
  });

  it("does nothing outside a slot, on a slot already written, or on a preview deployment", async () => {
    const provider = providerFetch();
    expect(await run(provider.impl, { now: new Date("2026-10-27T14:05:00Z") })).toEqual({ status: "idle", reason: "no_slot" });
    db.tables.editorials.push({ id: "taken", slot_key: "2026-W44:mon", status: "skipped", skip_reason: "paused", is_test: false, created_at: RUN_NOW.toISOString() });
    expect(await run(provider.impl)).toEqual({ status: "idle", reason: "slot_taken" });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await run(provider.impl)).toEqual({ status: "idle", reason: "preview" });
    expect(provider.impl).not.toHaveBeenCalled();
  });

  it("still runs an older slot inside its window after a newer due slot is taken", async () => {
    const lateNight = { id: "late-night", label: "Late night", enabled: true, startDate: "2026-10-26", endDate: "2026-10-26", cadence: "daily", hourUtc: 23, model: "claude-opus-5-5", holdHours: 8 };
    settings({ paused: true, hourUtc: 0, days: ["tue"], bursts: [lateNight] });
    db.tables.editorials.push({ id: "taken", slot_key: "2026-W44:tue", status: "skipped", skip_reason: "paused", is_test: false, created_at: RUN_NOW.toISOString() });
    const now = new Date("2026-10-27T01:05:00Z");
    expect(await run(providerFetch().impl, { now })).toEqual({ status: "skipped", slot: "burst:late-night:2026-10-26", reason: "paused" });
    expect(await run(providerFetch().impl, { now })).toEqual({ status: "idle", reason: "slot_taken" });
  });

  it("runs a slot once when two wakes race", async () => {
    const provider = providerFetch();
    const results = await Promise.all([run(provider.impl), run(provider.impl)]);
    expect(results.filter((result) => result.status === "held")).toHaveLength(1);
    expect(results.filter((result) => result.status === "idle")).toHaveLength(1);
    expect(editorials()).toHaveLength(1);
    expect(provider.messageCalls()).toHaveLength(2);
  });

  it("throws a not-set-up error before the migration, without writing or calling anything", async () => {
    markColumnTablesMissing(db);
    const provider = providerFetch();
    await expect(run(provider.impl)).rejects.toBeInstanceOf(ColumnNotSetUpError);
    expect(provider.impl).not.toHaveBeenCalled();
  });

  it("isolation: the openrouter provider never borrows the scanner's OPENROUTER_API_KEY", async () => {
    settings({ provider: "openrouter" });
    vi.stubEnv("OPENROUTER_API_KEY", "scanner-key-must-not-be-used");
    vi.stubEnv("COLUMN_OPENROUTER_API_KEY", "");
    const provider = providerFetch();
    expect(await run(provider.impl)).toEqual({ status: "skipped", slot: "2026-W44:mon", reason: "provider_unavailable" });
    expect(provider.impl).not.toHaveBeenCalled();
    expect(db.tables.editorial_ai_spend).toEqual([]);
  });

  it.each(["anthropic", "openrouter"])("isolation: a column run on %s writes only to the column's tables, never the scanner's ledger, budget or settings", async (selected) => {
    const scannerSettings = { key: "scanner", value: { paused: false, monthlyLlmUsdCap: 5, modelPreset: "gpt_5_6_luna" }, updated_at: "2026-10-01T00:00:00Z" };
    const aiSettings = { id: true, configuration: { policy: { monthlyUsd: 5 } }, revision: 7 };
    db = createFakeDb({ automation_settings: [scannerSettings], ai_settings_state: [aiSettings] }, () => RUN_NOW);
    settings({ provider: selected, nextEditionModel: "claude-sonnet-5-5" });
    vi.stubEnv("COLUMN_OPENROUTER_API_KEY", "or-column-key");
    expect(await run(providerFetch().impl)).toMatchObject({ status: "held" });
    expect(db.tables.automation_settings.find((row) => row.key === "scanner")).toEqual(scannerSettings);
    expect(db.tables.ai_settings_state).toEqual([aiSettings]);
    expect(db.tables.editorial_ai_spend.map((row) => row.provider)).toEqual([selected, selected]);
    const touched = [...db.touched];
    expect(touched.filter((name) => !["automation_settings", "editorials", "editorial_ai_spend", "voice_examples", "style_notes"].includes(name) && !name.startsWith("rpc:editorial_"))).toEqual([]);
    expect(touched).not.toContain("ai_settings_state");
  });
});
