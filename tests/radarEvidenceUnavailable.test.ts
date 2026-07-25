import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The radar and the evidence counts are different registers. A failed
 * report/tap count must not disconnect a radar whose own reads succeeded —
 * the counts degrade to null (unavailable) on their own. Only the radar's
 * own run reads may disconnect it.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from }),
  hasSupabaseServiceConfig: () => true,
}));
vi.mock("@/lib/officialPatch.server", () => ({
  getCurrentPatchMetadata: async () => ({
    version: "1.13.01",
    publishedAt: "2026-07-08T05:51:00.000Z",
    title: "Hotfix 1.13.01",
    sourceUrl: null,
  }),
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: async () => ({ paused: false, updatedAt: null, minIntervalMinutes: 60 }),
}));

function stubQuery(result: { data: unknown[] | null; error: { message: string } | null; count: number | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit", "range"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe("radar under failed evidence counts", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("stays connected with evidence null when only the count reads fail", async () => {
    mocks.from.mockImplementation((table: string) =>
      table === "bug_reports" || table === "issue_confirmations"
        ? stubQuery({ data: null, error: { message: "permission denied" }, count: null })
        : stubQuery({ data: [], error: null, count: 0 }),
    );
    const { getPatchRadarData } = await import("@/lib/radar.server");
    const radar = await getPatchRadarData();

    expect(radar.connected).toBe(true);
    expect(radar.evidence).toBeNull();
  });

  it("disconnects only when the radar's own run reads fail", async () => {
    mocks.from.mockImplementation((table: string) =>
      table === "automation_runs"
        ? stubQuery({ data: null, error: { message: "permission denied" }, count: null })
        : stubQuery({ data: [], error: null, count: 0 }),
    );
    const { getPatchRadarData } = await import("@/lib/radar.server");
    const radar = await getPatchRadarData();

    expect(radar.connected).toBe(false);
    // A disconnected radar read nothing — counts are unavailable, not zero.
    expect(radar.evidence).toBeNull();
  });
});
