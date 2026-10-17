import { describe, expect, it, vi } from "vitest";
import { mappingFingerprint, reuseClaimMapping } from "@/lib/automation/mappingCache.server";
import type { ClaimMappingDecision, ClaimMappingOptions } from "@/lib/automation/claimMapping";

const claim = { fixText: "Fixed map crash", category: "crash_startup" };
const clusters = [{ id: "fixture-cluster", slug: "map_crash", title: "Map crash", category: "crash_startup", description: "Crash when opening the map" }];
const patch = { version: "1.13", publishedAt: "2026-07-01T00:00:00.000Z" };
const options: ClaimMappingOptions = { llmCallsRemaining: 3, llmBudgetRemainingUsd: 1, modelPreset: "gpt_5_6_luna" };
const decision: ClaimMappingDecision = { matchKind: "llm_sure", clusterId: clusters[0].id, clusterSlug: clusters[0].slug,
  reason: "Same issue", llmCallsUsed: 1, llmCostUsd: 0.001, extractionModel: "fixture-model" };
const now = new Date("2026-07-05T00:00:00.000Z");
function fixture(value: unknown = null, error: unknown = null, saveError: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), limit: vi.fn(), upsert: vi.fn() };
  for (const name of ["select", "eq", "gt"] as const) query[name].mockReturnValue(query);
  query.limit.mockResolvedValue({ data: value === null ? [] : [{ decision: value }], error });
  query.upsert.mockResolvedValue({ error: saveError });
  const client = { from: vi.fn(() => query) } as unknown as Parameters<typeof reuseClaimMapping>[0];
  return { client, query, map: vi.fn(async () => decision) };
}
describe("private mapping reuse", () => {
  it("reuses only a validated decision with zero new calls or cost", async () => {
    const f = fixture(decision);
    expect(await reuseClaimMapping(f.client, claim, clusters, patch, options, f.map, now)).toMatchObject({
      clusterId: clusters[0].id, llmCallsUsed: 0, llmCostUsd: 0, extractionModel: null });
    expect(f.map).not.toHaveBeenCalled();
    expect(f.query.gt).toHaveBeenCalledWith("expires_at", now.toISOString());
    expect(f.query.upsert).not.toHaveBeenCalled();
  });
  it("invalidates changed claim, patch, eligible cluster, prompt/model and category inputs", () => {
    const key = mappingFingerprint(claim, clusters, patch, options);
    const keys = [
      mappingFingerprint({ ...claim, fixText: "Fixed a different crash" }, clusters, patch, options),
      mappingFingerprint({ ...claim, category: "performance" }, clusters, patch, options),
      mappingFingerprint(claim, clusters, { ...patch, version: "1.14" }, options),
      mappingFingerprint(claim, clusters.map((cluster) => ({ ...cluster, description: "Different issue" })), patch, options),
      mappingFingerprint(claim, [], patch, options),
      mappingFingerprint(claim, clusters, patch, { ...options, modelPreset: "deepseek_v4_flash_rollback" }),
    ];
    expect(keys.every((value) => value !== key)).toBe(true);
    expect(mappingFingerprint(claim, clusters, patch, { ...options, env: { OPENROUTER_API_KEY: "another-fixture-key" } })).toBe(key);
  });
  it.each([{ ...decision, clusterId: "missing" }, { ...decision, reason: "x".repeat(181) }, { ...decision, matchKind: "none" }])(
    "does not trust an invalid cache entry", async (cached) => {
      const f = fixture(cached);
      expect(await reuseClaimMapping(f.client, claim, clusters, patch, options, f.map, now)).toEqual(decision);
      expect(f.map).toHaveBeenCalledOnce();
    });
  it("keeps a valid proposal when the optional cache save fails and reports the failure", async () => {
    const error = { code: "42501", message: "PRIVATE error" };
    const f = fixture(null, null, error);
    const warning = vi.fn();
    expect(await reuseClaimMapping(f.client, claim, clusters, patch, options, f.map, now, warning)).toEqual(decision);
    expect(warning).toHaveBeenCalledWith(error);
  });
  it("fails closed on permission errors before spending, while exact missing table keeps rolling compatibility", async () => {
    const denied = fixture(null, { code: "42501", message: "permission denied" });
    await expect(reuseClaimMapping(denied.client, claim, clusters, patch, options, denied.map, now)).rejects.toMatchObject({
      diagnostic: { stage: "mapping_cache_read", code: "database_permission_denied" } });
    expect(denied.map).not.toHaveBeenCalled();
    const absent = fixture(null, { code: "PGRST205", message: "Could not find the table 'public.scanner_mapping_cache' in the schema cache" });
    expect(await reuseClaimMapping(absent.client, claim, clusters, patch, options, absent.map, now)).toEqual(decision);
    expect(absent.query.upsert).not.toHaveBeenCalled();
  });
  it("never caches a provider failure or a deterministic proposal", async () => {
    for (const value of [{ ...decision, skipReason: "openrouter_cost_unverified" as const }, { ...decision, llmCallsUsed: 0 }]) {
      const f = fixture();
      f.map.mockResolvedValue(value);
      await reuseClaimMapping(f.client, claim, clusters, patch, options, f.map, now);
      expect(f.query.upsert).not.toHaveBeenCalled();
    }
  });
});
