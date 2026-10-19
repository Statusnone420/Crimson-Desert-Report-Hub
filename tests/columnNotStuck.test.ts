import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactPack } from "@/lib/editorials/factPack";

const mocks = vi.hoisted(() => ({ pack: vi.fn<() => Promise<FactPack>>() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/editorials/factPack.server", () => ({ readFactPack: mocks.pack }));

import { buildAtomXml, buildRssXml, editionFeedEntry } from "@/lib/editorialFeed";
import { editorialArticles } from "@/lib/editorialArticles";
import { runColumn } from "@/lib/editorials/run.server";
import { readColumnDashboard, readVisibleEditions } from "@/lib/editorials/store.server";
import { createFakeDb, type FakeDb } from "./columnFakeDb";
import { GUIDES, json, pipelinePack, providerFetch } from "./columnPipelineFixtures";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 9, 26, 0, 0); // Monday, Oct 26
const WEEKS = 4;
let db: FakeDb;
let clock = START;

/** One wake every hour for four weeks: four weekly slots, each due for six hourly wakes. */
async function wakeHourly(fetchImpl: typeof fetch, fromMs = START, hours = WEEKS * 7 * 24) {
  for (let hour = 0; hour < hours; hour++) {
    clock = fromMs + hour * HOUR;
    await runColumn({ now: new Date(clock), deadlineMs: clock + 280_000, client: db.client, guides: GUIDES, clock: () => clock, fetchImpl });
  }
}

function rows() {
  return db.tables.editorials;
}

function slotKeys() {
  return rows().map((row) => row.slot_key);
}

const PUBLIC_FEED_BEFORE = { atom: buildAtomXml(editorialArticles), rss: buildRssXml(editorialArticles) };

async function expectPublicSurfacesUnchanged() {
  const editions = await readVisibleEditions(db.client, new Date(clock));
  expect(editions).toEqual([]);
  const entries = [...editorialArticles, ...editions.map(editionFeedEntry)];
  expect(buildAtomXml(entries)).toBe(PUBLIC_FEED_BEFORE.atom);
  expect(buildRssXml(entries)).toBe(PUBLIC_FEED_BEFORE.rss);
}

beforeEach(() => {
  clock = START;
  db = createFakeDb({}, () => new Date(clock));
  mocks.pack.mockResolvedValue(pipelinePack());
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-column");
  vi.stubEnv("COLUMN_OPENROUTER_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the column never gets stuck", () => {
  it("with Pause on for weeks: one paused row per slot, no calls, nothing public changes", async () => {
    db.tables.automation_settings.push({ key: "column", value: { paused: true } });
    const provider = providerFetch();
    await wakeHourly(provider.impl);
    expect(slotKeys()).toEqual(["2026-W44:mon", "2026-W45:mon", "2026-W46:mon", "2026-W47:mon"]);
    expect(rows().every((row) => row.status === "skipped" && row.skip_reason === "paused")).toBe(true);
    expect(provider.impl).not.toHaveBeenCalled();
    expect(db.tables.editorial_ai_spend).toEqual([]);
    await expectPublicSurfacesUnchanged();
    expect(await readColumnDashboard(db.client, new Date(clock))).toMatchObject({ state: "ready", settings: { paused: true } });
  });

  it("with no key: one quiet provider_unavailable row per slot and no calls", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const provider = providerFetch();
    await wakeHourly(provider.impl);
    expect(rows().map((row) => row.skip_reason)).toEqual(["provider_unavailable", "provider_unavailable", "provider_unavailable", "provider_unavailable"]);
    expect(provider.impl).not.toHaveBeenCalled();
    await expectPublicSurfacesUnchanged();
  });

  it.each([
    ["401", () => json(401, { error: { type: "authentication_error", message: "invalid x-api-key" } })],
    ["403", () => json(403, { error: { type: "permission_error", message: "not allowed" } })],
    ["credit balance too low", () => json(400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } })],
  ])("with the API refusing every call (%s): one row per slot, every reservation settled at $0", async (_label, writer) => {
    const provider = providerFetch({ writer });
    await wakeHourly(provider.impl);
    expect(rows().map((row) => [row.slot_key, row.status, row.skip_reason])).toEqual([
      ["2026-W44:mon", "skipped", "provider_unavailable"], ["2026-W45:mon", "skipped", "provider_unavailable"],
      ["2026-W46:mon", "skipped", "provider_unavailable"], ["2026-W47:mon", "skipped", "provider_unavailable"],
    ]);
    // One refused writer call per slot, never retried at later wakes.
    expect(provider.messageCalls()).toHaveLength(WEEKS);
    expect(db.tables.editorial_ai_spend.map((row) => [row.cost_state, row.settled_usd])).toEqual(Array.from({ length: WEEKS }, () => ["settled", 0]));
    expect(provider.calls.every((call) => call.url.startsWith("https://api.anthropic.com/"))).toBe(true);
    await expectPublicSurfacesUnchanged();
    expect(await readColumnDashboard(db.client, new Date(clock))).toMatchObject({ state: "ready", spend: { spentUsd: 0 } });
  });

  it("resumes at the next slot after unpausing, without making up the paused or missed ones", async () => {
    db.tables.automation_settings.push({ key: "column", value: { paused: true } });
    const provider = providerFetch();
    await wakeHourly(provider.impl, START, 8 * 24); // two weekly slots while paused
    expect(slotKeys()).toEqual(["2026-W44:mon", "2026-W45:mon"]);

    db.tables.automation_settings.find((row) => row.key === "column")!.value = { paused: false };
    // No wakes at all during the third slot's window: that slot is missed for good.
    await wakeHourly(provider.impl, Date.UTC(2026, 10, 9, 21), 7 * 24 - 21 + 15);
    expect(slotKeys()).toEqual(["2026-W44:mon", "2026-W45:mon", "2026-W47:mon"]);
    expect(rows().at(-1)).toMatchObject({ slot_key: "2026-W47:mon", status: "held" });
    expect(provider.messageCalls()).toHaveLength(2);
  });
});
