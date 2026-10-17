import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/officialPatch.server", () => ({ getCurrentPatchMetadata: mocks.patch }));
import { previewAutomationSearch } from "@/lib/automation/preview";
beforeEach(() => mocks.patch.mockReset().mockResolvedValue({ version: "1.13.00", source: "official",
  publishedAt: "2026-07-03T03:00:00Z" }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("read-only source preview", () => {
  it.each([0, 1, 2, 10, -1, NaN])("returns only a bounded plan without provider calls for %s queries", async (maxQueries) => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-key");
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-key");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await previewAutomationSearch({ maxQueries });
    expect(result).toMatchObject({ unavailableReason: "paid_diagnostics_disabled", queriesUsed: 0,
      resultsSeen: 0, estimatedCostUsd: 0, previews: [] });
    expect(result.queryPlan.length).toBe(result.maxQueries);
    expect(result.queryPlan.length).toBeLessThanOrEqual(2);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not construct search plans from an unverified patch", async () => {
    mocks.patch.mockResolvedValue({ version: "unknown", source: "fallback", publishedAt: null });
    expect(await previewAutomationSearch({ maxQueries: 2 })).toMatchObject({
      unavailableReason: "current_patch_unavailable", queryPlan: [], queriesUsed: 0, estimatedCostUsd: 0 });
  });
});
