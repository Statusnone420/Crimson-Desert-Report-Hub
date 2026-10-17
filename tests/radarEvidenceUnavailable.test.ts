import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The radar and the evidence counts are different registers. A failed
 * report/tap count must not disconnect a radar whose own reads succeeded —
 * the counts degrade to null (unavailable) on their own. Only the radar's
 * own run reads may disconnect it.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
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
  getCurrentPatchMetadata: mocks.getCurrentPatchMetadata,
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

function stubPagedQuery(
  resultForRange: (from: number, to: number) => { data: unknown[] | null; error: { message: string } | null; count: number | null },
) {
  let result: { data: unknown[] | null; error: { message: string } | null; count: number | null } = {
    data: null,
    error: null,
    count: null,
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit"]) {
    query[method] = () => query;
  }
  query.range = (from: number, to: number) => {
    result = resultForRange(from, to);
    return query;
  };
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe("radar under failed evidence counts", () => {
  beforeEach(() => {
    mocks.getCurrentPatchMetadata.mockResolvedValue({ version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z", source: "official" });
    mocks.from.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not publish patch-scoped radar counts without a verified current patch", async () => {
    mocks.getCurrentPatchMetadata.mockResolvedValue({ version: "unknown", publishedAt: null, source: "fallback" });
    const { getPatchRadarData } = await import("@/lib/radar.server");
    const radar = await getPatchRadarData();
    expect(radar.connected).toBe(false);
    expect(radar.evidence).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
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

  it("counts only approved reports in the current patch family", async () => {
    const reportRanges: Array<[number, number]> = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "bug_reports") {
        return stubPagedQuery((from, to) => {
          reportRanges.push([from, to]);
          return from === 0
            ? {
                data: Array.from({ length: 1000 }, (_, index) => ({ id: `older-family-${index}`, patch_version: "1.12.99" })),
                error: null,
                count: null,
              }
            : {
                data: [
                  { id: "family-base", patch_version: "1.13.00" },
                  { id: "family-hotfix", patch_version: "1.13.01" },
                  { id: "missing-patch", patch_version: null },
                ],
                error: null,
                count: null,
              };
        });
      }
      if (table === "issue_confirmations") {
        return stubQuery({ data: [], error: null, count: 3 });
      }
      return stubQuery({ data: [], error: null, count: 0 });
    });
    const { getPatchRadarData } = await import("@/lib/radar.server");
    const radar = await getPatchRadarData();

    expect(radar.evidence).toEqual({ reports: 2, taps: 3 });
    expect(reportRanges).toEqual([[0, 999], [1000, 1999]]);
  });

  it("keeps the radar connected when a later report page fails", async () => {
    const reportRanges: Array<[number, number]> = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "bug_reports") {
        return stubPagedQuery((from, to) => {
          reportRanges.push([from, to]);
          return from === 0
            ? {
                data: Array.from({ length: 1000 }, (_, index) => ({ id: `older-family-${index}`, patch_version: "1.12.99" })),
                error: null,
                count: null,
              }
            : { data: null, error: { message: "late page permission denied" }, count: null };
        });
      }
      return stubQuery({ data: [], error: null, count: 0 });
    });
    const { getPatchRadarData } = await import("@/lib/radar.server");
    const radar = await getPatchRadarData();

    expect(radar.connected).toBe(true);
    expect(radar.evidence).toBeNull();
    expect(reportRanges).toEqual([[0, 999], [1000, 1999]]);
    expect(console.error).toHaveBeenCalledWith(
      "[radar] evidence count read failed; reporting counts unavailable, radar intact",
      expect.objectContaining({ message: "approved reports read failed: late page permission denied" }),
    );
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
