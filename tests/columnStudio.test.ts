import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactPack } from "@/lib/editorials/factPack";

const mocks = vi.hoisted(() => ({ pack: vi.fn<() => Promise<FactPack>>() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/editorials/factPack.server", () => ({ readFactPack: mocks.pack }));

import { buildPreviewAtomXml } from "@/lib/editorials/previewFeed";
import { deleteVoiceExample, listVoiceExamples, moveVoiceExample, readColumnStudio, saveVoiceExample } from "@/lib/editorials/feedback.server";
import { styleNoteFromForm, voiceExampleFromForm } from "@/lib/editorials/feedbackForm";
import { runColumn } from "@/lib/editorials/run.server";
import { approvedEditions, latestFactPack } from "@/lib/editorials/runStore.server";
import { readPreviewEditions, readVisibleEditions } from "@/lib/editorials/store.server";
import { generateTestDraft } from "@/lib/editorials/testDraft.server";
import { createFakeDb, type FakeDb } from "./columnFakeDb";
import { GUIDES, pipelinePack, providerFetch, RUN_NOW } from "./columnPipelineFixtures";

let db: FakeDb;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function draft(model: "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-fable-5-1", fetchImpl: typeof fetch) {
  return generateTestDraft({ client: db.client, now: RUN_NOW, model, effort: "medium", guides: GUIDES, clock: () => RUN_NOW.getTime(), fetchImpl });
}

beforeEach(() => {
  db = createFakeDb({}, () => RUN_NOW);
  mocks.pack.mockResolvedValue(pipelinePack());
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-column");
});
afterEach(() => vi.unstubAllEnvs());

describe("editor notes", () => {
  it("accept a thumb, a note of up to 500 characters, or both", () => {
    expect(styleNoteFromForm(form({ rating: "up" }))).toEqual({ editorialId: null, rating: "up", note: null });
    expect(styleNoteFromForm(form({ editorialId: "e0000000-0000-4000-8000-000000000001", rating: "", note: " Less weather. " }))).toEqual({ editorialId: "e0000000-0000-4000-8000-000000000001", rating: null, note: "Less weather." });
    expect(styleNoteFromForm(form({ rating: "", note: "  " }))).toBeNull();
    expect(styleNoteFromForm(form({ note: "x".repeat(501) }))).toBeNull();
    expect(styleNoteFromForm(form({ rating: "sideways" }))).toBeNull();
    expect(styleNoteFromForm(form({ editorialId: "../x", rating: "up" }))).toBeNull();
  });
});

describe("voice examples", () => {
  it("accept 1 to 1,500 characters and a label of up to 80", () => {
    expect(voiceExampleFromForm(form({ body: "Deadpan.", label: "Weather" }))).toEqual({ id: null, body: "Deadpan.", label: "Weather" });
    expect(voiceExampleFromForm(form({ body: "   " }))).toBeNull();
    expect(voiceExampleFromForm(form({ body: "x".repeat(1501) }))).toBeNull();
    expect(voiceExampleFromForm(form({ body: "ok", label: "x".repeat(81) }))).toBeNull();
  });

  it("stop at five, in position order, with move and remove", async () => {
    for (const body of ["one", "two", "three", "four", "five"]) expect(await saveVoiceExample(db.client, { id: null, body, label: null })).toBe("saved");
    expect(await saveVoiceExample(db.client, { id: null, body: "six", label: null })).toBe("full");
    // The database refuses a sixth even if the count was read before another insert landed.
    db.tables.voice_examples.pop();
    db.tables.voice_examples.push({ id: "x", body: "racer", label: null, position: 9, created_at: RUN_NOW.toISOString() });
    expect(await saveVoiceExample(db.client, { id: null, body: "six", label: null })).toBe("full");
    db.tables.voice_examples.pop();
    const [first, second] = await listVoiceExamples(db.client);
    expect(await moveVoiceExample(db.client, second.id, "up")).toBe("moved");
    expect(db.touched).toContain("rpc:voice_examples_reorder");
    expect((await listVoiceExamples(db.client)).map((example) => example.body)).toEqual(["two", "one", "three", "four"]);
    await deleteVoiceExample(db.client, first.id);
    expect((await listVoiceExamples(db.client)).map((example) => example.body)).toEqual(["two", "three", "four"]);
  });

  it("move nothing when the list changes between the read and the reorder", async () => {
    for (const body of ["one", "two"]) await saveVoiceExample(db.client, { id: null, body, label: null });
    const [, second] = await listVoiceExamples(db.client);
    const rpc = db.client.rpc.bind(db.client);
    db.client.rpc = (async (name: string, args: Record<string, unknown>) => {
      db.tables.voice_examples.push({ id: "racer", body: "three", label: null, position: 2, created_at: RUN_NOW.toISOString() });
      return rpc(name, args);
    }) as unknown as typeof db.client.rpc;
    expect(await moveVoiceExample(db.client, second.id, "up")).toBe("changed");
    expect(db.tables.voice_examples.map((example) => [example.body, example.position])).toEqual([["one", 0], ["two", 1], ["three", 2]]);
  });

  it("rotate in at most two thumbs-up editions, newest rating first, never a skip", async () => {
    const body = "## The forecast\n\nClear skies.";
    db.tables.editorials.push(
      { id: "a", slot_key: "2026-W40:s0", status: "published", title: "A", body_md: body, is_test: false },
      { id: "b", slot_key: "test:2026-10-20", status: "held", title: "B", body_md: body, is_test: true },
      { id: "c", slot_key: "2026-W42:s0", status: "held", title: "C", body_md: body, is_test: false },
      { id: "s", slot_key: "2026-W43:s0", status: "skipped", skip_reason: "paused", is_test: false },
    );
    db.tables.style_notes.push(
      { id: "n1", editorial_id: "a", rating: "up", created_at: "2026-10-20T00:00:00Z" },
      { id: "n2", editorial_id: "b", rating: "up", created_at: "2026-10-22T00:00:00Z" },
      { id: "n3", editorial_id: "s", rating: "up", created_at: "2026-10-23T00:00:00Z" },
      { id: "n4", editorial_id: "c", rating: "down", created_at: "2026-10-24T00:00:00Z" },
      { id: "n5", editorial_id: "a", rating: "up", created_at: "2026-10-25T00:00:00Z" },
    );
    expect((await approvedEditions(db.client)).map((edition) => edition.id)).toEqual(["a", "b"]);
    expect((await readColumnStudio(db.client, RUN_NOW)).rotation).toEqual([{ id: "a", title: "A" }, { id: "b", title: "B" }]);
  });

  it("drop an edition from the rotation when its newest rating is a thumbs down", async () => {
    const body = "## The forecast\n\nClear skies.";
    db.tables.editorials.push(
      { id: "a", slot_key: "2026-W40:mon", status: "published", title: "A", body_md: body, is_test: false },
      { id: "b", slot_key: "2026-W41:mon", status: "published", title: "B", body_md: body, is_test: false },
    );
    db.tables.style_notes.push(
      { id: "n1", editorial_id: "a", rating: "up", created_at: "2026-10-20T00:00:00Z" },
      { id: "n2", editorial_id: "b", rating: "up", created_at: "2026-10-21T00:00:00Z" },
      { id: "n3", editorial_id: "a", rating: "down", created_at: "2026-10-22T00:00:00Z" },
      { id: "n4", editorial_id: "b", rating: null, note: "Shorter next time.", created_at: "2026-10-23T00:00:00Z" },
    );
    expect((await approvedEditions(db.client)).map((edition) => edition.id)).toEqual(["b"]);
  });

  it("find the second approved edition behind many thumbs on the first", async () => {
    const body = "## The forecast\n\nClear skies.";
    db.tables.editorials.push(
      { id: "a", slot_key: "2026-W40:mon", status: "published", title: "A", body_md: body, is_test: false },
      { id: "b", slot_key: "2026-W41:mon", status: "published", title: "B", body_md: body, is_test: false },
    );
    for (let index = 0; index < 120; index++) db.tables.style_notes.push({ id: `n${index}`, editorial_id: "a", rating: "up", created_at: new Date(Date.UTC(2026, 9, 25, 0, index)).toISOString() });
    db.tables.style_notes.push({ id: "old", editorial_id: "b", rating: "up", created_at: "2026-10-01T00:00:00Z" });
    expect((await approvedEditions(db.client)).map((edition) => edition.id)).toEqual(["a", "b"]);
  });
});

describe("A/B test drafts", () => {
  it("run the full pipeline on the same stored fact pack for every model and are never public", async () => {
    db.tables.editorials.push({ id: "real", slot_key: "2026-W43:s0", status: "skipped", skip_reason: "below_threshold", is_test: false, fact_pack: pipelinePack(), created_at: "2026-10-19T14:00:00Z", updated_at: "2026-10-19T14:00:00Z" });
    const provider = providerFetch();
    expect(await draft("claude-sonnet-5-5", provider.impl)).toEqual({ status: "saved" });
    expect(await draft("claude-fable-5-1", provider.impl)).toEqual({ status: "saved" });
    expect(mocks.pack).not.toHaveBeenCalled();
    const tests = db.tables.editorials.filter((row) => row.is_test);
    expect(tests.map((row) => [row.status, row.publish_at, row.writer_model, row.slot_key])).toEqual([
      ["held", null, "claude-sonnet-5-5", "test:2026-10-26"], ["held", null, "claude-fable-5-1", "test:2026-10-26"],
    ]);
    expect(new Set(tests.map((row) => row.slug)).size).toBe(2);
    expect(db.tables.editorial_ai_spend.map((row) => row.operation)).toEqual(["test_writer", "test_checker", "test_writer", "test_checker"]);
    expect(await readVisibleEditions(db.client, new Date(RUN_NOW.getTime() + 30 * 86_400_000))).toEqual([]);
    const preview = buildPreviewAtomXml(await readPreviewEditions(db.client, RUN_NOW), RUN_NOW);
    expect(preview).toContain("TEST · Sonnet 5.5 · Clear skies over the inventory screen");
    expect(preview).toContain("TEST · Fable 5.1 · Clear skies over the inventory screen");
  });

  it("use the freshest stored pack by when it was built, even when an older one was saved last", async () => {
    const newer = { ...pipelinePack(), builtAt: "2026-10-26T13:00:00.000Z" };
    const older = { ...pipelinePack(), builtAt: "2026-10-26T10:00:00.000Z" };
    db.tables.editorials.push(
      { id: "real", slot_key: "2026-W44:mon", status: "skipped", skip_reason: "below_threshold", is_test: false, fact_pack: newer, created_at: "2026-10-26T13:00:00Z", updated_at: "2026-10-26T13:00:00Z" },
      { id: "late", slot_key: "test:2026-10-26", status: "skipped", skip_reason: "writer_failed", is_test: true, fact_pack: older, created_at: "2026-10-26T13:05:00Z", updated_at: "2026-10-26T13:05:00Z" },
      { id: "undated", slot_key: "test:2026-10-26", status: "skipped", skip_reason: "writer_failed", is_test: true, fact_pack: { version: 1, facts: [] }, created_at: "2026-10-26T13:10:00Z", updated_at: "2026-10-26T13:10:00Z" },
    );
    expect((await latestFactPack(db.client))?.builtAt).toBe(newer.builtAt);
  });

  it("skip before any paid call when the budget can't cover both the writer and the checker", async () => {
    db.tables.editorials.push({ id: "real", slot_key: "2026-W43:s0", status: "skipped", skip_reason: "below_threshold", is_test: false, fact_pack: pipelinePack(), created_at: "2026-10-19T14:00:00Z", updated_at: "2026-10-19T14:00:00Z" });
    db.tables.editorial_ai_spend.push({ id: "spent", month: "2026-10", operation: "writer", provider: "anthropic", model: "claude-opus-5-5", reserved_usd: 14.9, settled_usd: 14.9, cost_state: "settled", created_at: RUN_NOW.toISOString() });
    const provider = providerFetch();
    expect(await draft("claude-sonnet-5-5", provider.impl)).toEqual({ status: "skipped", reason: "budget" });
    expect(provider.messageCalls()).toEqual([]);
    expect(db.tables.editorials.filter((row) => row.is_test).map((row) => [row.status, row.skip_reason])).toEqual([["skipped", "budget"]]);
  });

  it("build a pack without saving an edition when none is stored", async () => {
    expect(await draft("claude-opus-5-5", providerFetch().impl)).toEqual({ status: "saved" });
    expect(mocks.pack).toHaveBeenCalledOnce();
    expect(db.tables.editorials.filter((row) => !row.is_test)).toEqual([]);
  });

  it("stop at ten a UTC day", async () => {
    const provider = providerFetch();
    for (let count = 0; count < 10; count++) expect(await draft("claude-sonnet-5-5", provider.impl)).toEqual({ status: "saved" });
    expect(await draft("claude-sonnet-5-5", provider.impl)).toEqual({ status: "daily_cap" });
    expect(db.tables.editorials.filter((row) => row.is_test)).toHaveLength(10);
    expect((await readColumnStudio(db.client, RUN_NOW)).testsToday).toBe(10);
  });

  it("record a failed draft as a skipped test row, quietly, with no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const provider = providerFetch();
    expect(await draft("claude-opus-5-5", provider.impl)).toEqual({ status: "skipped", reason: "provider_unavailable" });
    expect(provider.impl).not.toHaveBeenCalled();
    expect(db.tables.editorials).toEqual([expect.objectContaining({ is_test: true, status: "skipped", skip_reason: "provider_unavailable" })]);
  });

  it("never take the slot or clear the one-shot writer override", async () => {
    db.tables.automation_settings.push({ key: "column", value: { nextEditionModel: "claude-fable-5-1" } });
    await draft("claude-sonnet-5-5", providerFetch().impl);
    expect((db.tables.automation_settings.find((row) => row.key === "column")!.value as Record<string, unknown>).nextEditionModel).toBe("claude-fable-5-1");
    const provider = providerFetch();
    const outcome = await runColumn({ now: RUN_NOW, deadlineMs: RUN_NOW.getTime() + 280_000, client: db.client, guides: GUIDES, clock: () => RUN_NOW.getTime(), fetchImpl: provider.impl });
    expect(outcome).toMatchObject({ status: "held", slot: "2026-W44:mon" });
    expect(provider.messageCalls()[0].body.model).toBe("claude-fable-5-1");
  });
});
