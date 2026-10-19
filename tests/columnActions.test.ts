import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_SENTINEL = "auth sentinel: admin session required";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  preview: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/adminGuard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/previewGuard", () => ({ assertProductionWriteAllowed: () => { if (mocks.preview()) throw new Error("preview writes disabled"); } }));

import {
  approveEdition, deleteColumnBurst, deleteVoiceExampleAction, generateTestDraftAction, moveVoiceExampleAction, publishTestDraft, saveColumnBurst,
  saveColumnCadence, saveStyleNote, saveVoiceExampleAction, setColumnPaused, vetoEdition,
} from "@/app/operator/column-actions";

const ID = "e0000000-0000-4000-8000-000000000001";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function updateChain(result: { data: unknown; error: unknown }) {
  const chain = { update: vi.fn(), eq: vi.fn(), in: vi.fn(), select: vi.fn(async () => result) };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(undefined);
  mocks.preview.mockReturnValue(false);
});

describe("Column card actions", () => {
  it("require an admin session before touching anything", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error(AUTH_SENTINEL));
    mocks.from.mockImplementation(() => { throw new Error("tripwire: database"); });
    mocks.rpc.mockImplementation(() => { throw new Error("tripwire: rpc"); });
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(saveColumnCadence(form({ mode: "weekly", days: "mon", hourUtc: "14", holdHours: "24", relevance: "normal", minGapHours: "20", provider: "anthropic" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(saveColumnBurst(form({ label: "Launch", model: "claude-opus-5-5", startDate: "2026-10-29", endDate: "2026-11-04", hourUtc: "14", holdHours: "8" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(deleteColumnBurst(form({ id: "expansion-launch" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(saveStyleNote(form({ rating: "up", note: "More horses." }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(saveVoiceExampleAction(form({ body: "Deadpan." }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(deleteVoiceExampleAction(form({ id: ID }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(moveVoiceExampleAction(form({ id: ID, direction: "up" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(generateTestDraftAction(form({ model: "claude-sonnet-5-5", effort: "high" }))).rejects.toThrow(AUTH_SENTINEL);
    await expect(publishTestDraft(form({ id: ID, slotKey: "2026-W43:mon", confirm: "yes" }))).rejects.toThrow(AUTH_SENTINEL);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("are disabled on preview deployments", async () => {
    mocks.preview.mockReturnValue(true);
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow("preview writes disabled");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("pause merges only the paused key", async () => {
    mocks.rpc.mockResolvedValue({ data: { paused: true }, error: null });
    await expect(setColumnPaused(form({ paused: "true" }))).rejects.toThrow("NEXT_REDIRECT /operator?view=column&notice=paused");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_settings_merge", { p_patch: { paused: true } });
    await expect(setColumnPaused(form({ paused: "maybe" }))).rejects.toThrow("Choose pause or resume");
  });

  it("veto sets vetoed and revalidates every public surface plus the editorials cache", async () => {
    const chain = updateChain({ data: [{ id: ID }], error: null });
    mocks.from.mockReturnValue(chain);
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow("notice=vetoed");
    expect(mocks.from).toHaveBeenCalledWith("editorials");
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "vetoed", vetoed_at: expect.any(String) }));
    expect(chain.in).toHaveBeenCalledWith("status", ["held", "published"]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-editorials", { expire: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed.xml");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/editorials/[slug]", "page");
  });

  it("veto of an edition already gone changes nothing and says so", async () => {
    mocks.from.mockReturnValue(updateChain({ data: [], error: null }));
    await expect(vetoEdition(form({ id: ID }))).rejects.toThrow("notice=not_vetoable");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("approve publishes through the database function and revalidates", async () => {
    mocks.rpc.mockResolvedValue({ data: "approved", error: null });
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow("notice=approved");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_approve", { p_id: ID });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-editorials", { expire: 0 });
  });

  it("approve of an edition no longer waiting changes nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: "not_pending", error: null });
    await expect(approveEdition(form({ id: ID }))).rejects.toThrow("notice=not_pending");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("refuse a malformed edition id before any database call", async () => {
    await expect(vetoEdition(form({ id: "not-a-uuid" }))).rejects.toThrow("could not be found");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("saves only the cadence keys, and refuses mismatched days without writing", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const cadence = { mode: "weekly", days: "fri", hourUtc: "9", holdHours: "12", relevance: "strict", minGapHours: "30", defaultWriterModel: "claude-sonnet-5-5", nextEditionModel: "", monthlyCapUsd: "20", provider: "anthropic" };
    await expect(saveColumnCadence(form(cadence))).rejects.toThrow("notice=settings_saved");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_settings_merge", { p_patch: {
      mode: "weekly", days: ["fri"], hourUtc: 9, holdHours: 12, relevance: "strict", minGapHours: 30, provider: "anthropic",
      defaultWriterModel: "claude-sonnet-5-5", nextEditionModel: null, monthlyCapUsd: 20,
    } });
    mocks.rpc.mockClear();
    const twoDays = new FormData();
    for (const [key, value] of Object.entries({ ...cadence, mode: "2x" })) twoDays.set(key, value);
    await expect(saveColumnCadence(twoDays)).rejects.toThrow("notice=days_mismatch");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("replaces an existing burst by id and deletes one by id", async () => {
    const stored = [{ id: "expansion-launch", label: "Expansion launch", enabled: false, startDate: "2026-10-29", endDate: "2026-11-04", cadence: "daily", hourUtc: 14, model: "claude-opus-5-5", holdHours: 8, relevance: "always" }];
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ value: { bursts: stored }, updated_at: null }], error: null }) }) }) });
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    await expect(saveColumnBurst(form({ id: "expansion-launch", label: "Expansion launch", model: "claude-fable-5-1", startDate: "2026-10-29", endDate: "2026-11-04", hourUtc: "15", holdHours: "6", enabled: "on" }))).rejects.toThrow("notice=burst_saved");
    expect(mocks.rpc).toHaveBeenLastCalledWith("editorial_settings_merge", { p_patch: { bursts: [expect.objectContaining({ id: "expansion-launch", model: "claude-fable-5-1", hourUtc: 15, enabled: true })] } });
    await expect(deleteColumnBurst(form({ id: "expansion-launch" }))).rejects.toThrow("notice=burst_deleted");
    expect(mocks.rpc).toHaveBeenLastCalledWith("editorial_settings_merge", { p_patch: { bursts: [] } });
    await expect(deleteColumnBurst(form({ id: "gone" }))).rejects.toThrow("notice=burst_missing");
  });

  it("refuse invalid notes, examples and test drafts before any database call", async () => {
    await expect(saveStyleNote(form({ rating: "", note: "" }))).rejects.toThrow("notice=note_invalid");
    await expect(saveVoiceExampleAction(form({ body: "x".repeat(1501) }))).rejects.toThrow("notice=example_invalid");
    await expect(generateTestDraftAction(form({ model: "claude-haiku-5-5", effort: "high" }))).rejects.toThrow("notice=test_invalid");
    await expect(generateTestDraftAction(form({ model: "claude-opus-5-5", effort: "max" }))).rejects.toThrow("notice=test_invalid");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("save a note for an edition and go back to that edition", async () => {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    mocks.from.mockReturnValue({ insert });
    await expect(saveStyleNote(form({ editorialId: ID, rating: "down", note: "Less weather." }))).rejects.toThrow(`NEXT_REDIRECT /operator?view=column&edition=${ID}&notice=note_saved`);
    expect(insert).toHaveBeenCalledWith({ editorial_id: ID, rating: "down", note: "Less weather." });
  });
});

describe("publishing a test draft", () => {
  const settingsRead = () => {
    const chain = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(async () => ({ data: [{ value: {}, updated_at: null }], error: null })) };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return chain;
  };
  const publish = (values: Record<string, string> = {}) => publishTestDraft(form({ id: ID, slotKey: "2026-W43:mon", confirm: "yes", ...values }));

  beforeEach(() => {
    // Monday Oct 19, after the default 14:00 slot of week 43.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T19:40:00Z"));
    mocks.from.mockReturnValue(settingsRead());
  });
  afterEach(() => vi.useRealTimers());

  it("publishes through the database function into this week's slot and revalidates", async () => {
    mocks.rpc.mockResolvedValue({ data: "promoted", error: null });
    await expect(publish()).rejects.toThrow(`NEXT_REDIRECT /operator?view=column&edition=${ID}&notice=draft_published`);
    expect(mocks.from).toHaveBeenCalledWith("automation_settings");
    expect(mocks.rpc).toHaveBeenCalledWith("editorial_promote_test", { p_id: ID, p_slot_key: "2026-W43:mon" });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("public-editorials", { expire: 0 });
  });

  it("needs the confirm tick, and publishes only into the slot the page showed", async () => {
    await expect(publish({ confirm: "" })).rejects.toThrow("notice=publish_confirm");
    await expect(publish({ slotKey: "2026-W42:mon" })).rejects.toThrow("notice=publish_slot_changed");
    vi.setSystemTime(new Date("2026-10-19T13:00:00Z"));
    await expect(publish()).rejects.toThrow("notice=publish_no_slot");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["not_approved", "publish_not_approved"],
    ["slot_taken", "publish_slot_taken"],
    ["not_promotable", "publish_not_promotable"],
  ])("says why the database refused (%s) and changes nothing", async (result, notice) => {
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await expect(publish()).rejects.toThrow(`edition=${ID}&notice=${notice}`);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("says the database update hasn't landed before the migration, and fails loudly on anything else", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.editorial_promote_test(p_id, p_slot_key) in the schema cache" } });
    await expect(publish()).rejects.toThrow("notice=publish_unavailable");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for table editorials" } });
    await expect(publish()).rejects.toThrow("could not be published");
    mocks.rpc.mockResolvedValue({ data: "bad_slot", error: null });
    await expect(publish()).rejects.toThrow("could not be published");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
