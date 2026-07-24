import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed dashboard read must surface as the unavailable state, never as an
 * empty success rendered as zeros (AGENTS.md: database failures must fail or
 * be explicitly surfaced). The read throws inside readDashboardData and the
 * loader converts it into `evidenceUnavailable: true` plus a loud log line.
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
  getClaimedFixesForCurrentPatch: async () => [],
}));

/** Chainable query stub: every builder method returns itself; awaiting it resolves the injected result. */
function failingQuery(message: string) {
  const result = { data: null, error: { message }, count: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit", "range"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

describe("dashboard loader under a failed read", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.from.mockImplementation(() => failingQuery("permission denied for table bug_reports"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the unavailable state instead of fabricated zeros, loudly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(true);
    // The fallback shape is empty, and the flag is what stops it rendering as zeros.
    expect(data.total).toBe(0);
    expect(data.topClusters).toEqual([]);
    expect(data.currentPatch.version).toBe("1.13.01");
    // The failure is surfaced in server logs, not swallowed.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("unavailable state"),
      expect.objectContaining({ message: expect.stringContaining("permission denied") }),
    );
  });
});
