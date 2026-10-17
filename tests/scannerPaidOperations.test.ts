import { afterEach, describe, expect, it, vi } from "vitest";
import { extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";
import { tavilyExtract, TavilyExtractNoContentError, tavilySearch } from "@/lib/automation/search";
import { ScannerAccountingError, type PaidOperationGuard } from "@/lib/automation/paidOperation";
import type { OpenRouterAttempt } from "@/lib/automation/openRouterTrace";

const cluster = { id: "cluster", slug: "map_crash", title: "Map crash", category: "crash_startup" };
const env = { OPENROUTER_API_KEY: "fixture-key", TAVILY_API_KEY: "fixture-key" };
const extraction = { issueTitle: "Map crash", category: "crash_startup", platform: "pc_steam", confidence: "high",
  summary: "Crimson Desert crashes when opening the map.", clusterAssignment: "sure", clusterReason: "Same issue", clusterSlug: cluster.slug };
const lanes = [
  { name: "extraction", content: extraction,
    run: (guard: PaidOperationGuard, fetcher: NonNullable<Parameters<typeof extractSignalWithOpenRouter>[1]["fetcher"]>, onAttempt: (value: OpenRouterAttempt) => void) =>
      extractSignalWithOpenRouter({ title: "Map crash", snippet: "Crimson Desert crashes", url: "https://fixture.test" },
        { env, paidGuard: guard, fetcher, onAttempt, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1, clusterOptions: [cluster] }) },
  { name: "mapping", content: { matchKind: "sure", clusterSlug: cluster.slug, reason: "Same issue" },
    run: (guard: PaidOperationGuard, fetcher: NonNullable<Parameters<typeof extractSignalWithOpenRouter>[1]["fetcher"]>, onAttempt: (value: OpenRouterAttempt) => void) =>
      mapClaimToClusterWithOpenRouter({ fixText: "Fixed map crash", category: "crash_startup" }, [cluster],
        { env, paidGuard: guard, fetcher, onAttempt, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 }) },
];
function fixtureGuard() {
  const settle = vi.fn(async () => {});
  const begin = vi.fn<PaidOperationGuard["begin"]>(async () => ({ settle }));
  return { guard: { begin, deadlineAtMs: Date.now() + 100_000 } satisfies PaidOperationGuard, begin, settle };
}
afterEach(() => vi.useRealTimers());
for (const lane of lanes) describe(`${lane.name} essential accounting`, () => {
  it("dispatches only after reservation and settles the actual cost", async () => {
    const { guard, begin, settle } = fixtureGuard();
    const fetcher = vi.fn(async (_url, init) => {
      expect(begin).toHaveBeenCalledOnce();
      expect(begin.mock.calls[0]?.[1]).toBe(init.body);
      return { ok: true, status: 200, json: async () => ({ usage: { cost: 0.001 }, choices: [{ message: { content: JSON.stringify(lane.content) } }] }) };
    });
    await lane.run(guard, fetcher, () => {});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith({ state: "verified", llmCostUsd: 0.001, tavilyCredits: 0 });
  });
  it("does not dispatch when a reservation acknowledgment is lost", async () => {
    const { guard, begin } = fixtureGuard();
    begin.mockRejectedValue(new ScannerAccountingError("reservation_unacknowledged"));
    const fetcher = vi.fn();
    await expect(lane.run(guard, fetcher, () => {})).rejects.toMatchObject({ code: "reservation_unacknowledged" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains a successful AI trace when the settlement acknowledgment fails, without retrying inference", async () => {
    const { guard, settle } = fixtureGuard();
    settle.mockRejectedValue(new ScannerAccountingError("settlement_unacknowledged"));
    const attempts: OpenRouterAttempt[] = [];
    const fetcher = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ usage: { cost: 0.001 }, choices: [{ message: { content: JSON.stringify(lane.content) } }] }) }));
    await expect(lane.run(guard, fetcher, (value) => { attempts.push(value); })).rejects.toMatchObject({ code: "settlement_unacknowledged" });
    expect(attempts.at(-1)).toMatchObject({ outcome: "success", costState: "verified" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps a reservation for an ambiguous dispatched request", async () => {
    const { guard, settle } = fixtureGuard();
    const fetcher = vi.fn(async () => { throw new Error("fixture transport failure"); });
    await lane.run(guard, fetcher, () => {});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledWith({ state: "unknown", llmCostUsd: null, tavilyCredits: null });
  });
});
describe("Tavily essential accounting", () => {
  it.each([
    { results: [{ raw_content: 5 }] }, { failed_results: {} }, { usage: null }, null,
    // Without page text, an entry must still name its URL, or the empty answer is malformed.
    { results: [{}] }, { results: ["invalid"] }, { results: [null] }, { failed_results: [{}] },
    { results: [{ raw_content: "" }], usage: { credits: 0 } },
    { results: [{ url: "", raw_content: "" }] }, { results: [{ url: "   " }] }, { results: [{ url: "fixture" }] },
    { failed_results: [{ url: "" }] },
    // A refusal naming the requested URL waives nothing beside a malformed entry.
    { failed_results: [{ url: "https://fixture.test/" }, {}], usage: { credits: 0 } },
    // Nor does an answer of the wrong shape: a top-level list, null lists, list-shaped usage, or a non-web URL.
    [[]], { results: null }, { failed_results: null }, { usage: [] }, { results: [{ url: "mailto:fixture@example.test" }] },
  ])("retains an unknown extraction charge for malformed provider data: %j", async (payload) => {
    const { guard, settle } = fixtureGuard();
    await expect(tavilyExtract("https://fixture.test/", { env, paidGuard: guard,
      fetcher: async () => ({ ok: true, status: 200, json: async () => payload }) })).rejects.toThrow("invalid results");
    expect(settle).toHaveBeenCalledWith({ state: "unknown", llmCostUsd: null, tavilyCredits: null });
  });
  it.each(["search", "extract"])("books fractional %s usage conservatively and labels it estimated", async (lane) => {
    const { guard, settle } = fixtureGuard();
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () =>
      ({ usage: { credits: 2.5 }, results: [{ title: "fixture", url: "https://fixture.test", content: "fixture", raw_content: "fixture" }] }) }));
    if (lane === "search") await tavilySearch("fixture", { env, paidGuard: guard, fetcher });
    else await tavilyExtract("https://fixture.test", { env, paidGuard: guard, fetcher });
    expect(settle).toHaveBeenCalledWith({ state: "estimated", llmCostUsd: 0, tavilyCredits: 3 });
  });
  it("does not refund a successful extraction reporting zero usage", async () => {
    const { guard, settle } = fixtureGuard();
    await tavilyExtract("https://fixture.test", { env, paidGuard: guard,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ usage: { credits: 0 }, results: [{ raw_content: "fixture" }] }) }) });
    expect(settle).toHaveBeenCalledWith({ state: "estimated", llmCostUsd: 0, tavilyCredits: 1 });
  });
  it("releases only an explicitly unbilled refusal", async () => {
    const { guard, settle } = fixtureGuard();
    await tavilyExtract("https://fixture.test/", { env, paidGuard: guard,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ usage: { credits: 0 }, failed_results: [{ url: "https://fixture.test/" }] }) }) });
    expect(settle).toHaveBeenCalledWith({ state: "verified", llmCostUsd: 0, tavilyCredits: 0 });
  });
  it.each([
    [{ results: [] }, "estimated", 1],
    [{ results: [{ url: "https://fixture.test/", raw_content: "   " }], usage: { credits: 0 } }, "estimated", 1],
    [{ results: [{ url: "https://fixture.test/", raw_content: "" }], usage: { credits: -1 } }, "estimated", 1],
    [{ results: [{ url: "https://fixture.test/" }] }, "estimated", 1],
    [{ results: [], failed_results: [{ url: "https://other.test/", error: "fixture" }], usage: { credits: 0 } }, "estimated", 1],
    // A refusal next to a result is no clean refusal: Tavily may have billed the result.
    [{ results: [{ url: "https://fixture.test/", raw_content: "" }], failed_results: [{ url: "https://fixture.test/" }], usage: { credits: 0 } }, "estimated", 1],
    [{ results: [], failed_results: [{ url: "https://fixture.test/" }], usage: { credits: 1 } }, "verified", 1],
  ] as const)("books an answered empty extraction at its bounded worst case, not as unknown: %j", async (payload, state, tavilyCredits) => {
    // An unknown cost stops every later paid call in the run; an empty page must not.
    const { guard, settle } = fixtureGuard();
    await expect(tavilyExtract("https://fixture.test/", { env, paidGuard: guard,
      fetcher: async () => ({ ok: true, status: 200, json: async () => payload }) })).rejects.toBeInstanceOf(TavilyExtractNoContentError);
    expect(settle).toHaveBeenCalledWith({ state, llmCostUsd: 0, tavilyCredits });
  });
});
