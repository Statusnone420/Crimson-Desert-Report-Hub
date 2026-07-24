import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed dashboard read must surface as the unavailable state, never as an
 * empty success rendered as zeros (AGENTS.md: database failures must fail or
 * be explicitly surfaced). The read throws inside readDashboardData and the
 * loader converts it into `evidenceUnavailable: true` plus a loud log line.
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  claimedFixes: vi.fn(async (): Promise<{ fixText: string; category: string | null }[]> => []),
  controlState: vi.fn(async (): Promise<{ paused: boolean; updatedAt: string | null }> => ({
    paused: false,
    updatedAt: null,
  })),
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
  getClaimedFixesForCurrentPatch: mocks.claimedFixes,
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: mocks.controlState,
}));

/** Chainable query stub: every builder method returns itself; awaiting it resolves the injected result. */
function stubQuery(result: { data: unknown[] | null; error: { message: string } | null; count: number | null }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit", "range"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

function failingQuery(message: string) {
  return stubQuery({ data: null, error: { message }, count: null });
}

function okQuery() {
  return stubQuery({ data: [], error: null, count: 0 });
}

/** bug_reports stub that succeeds for approved reads but fails the pending count. */
function pendingFailingBugReports() {
  let pending = false;
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "lte", "not", "order", "limit", "range"]) {
    query[method] = (...args: unknown[]) => {
      if (method === "eq" && args[1] === "pending") pending = true;
      return query;
    };
  }
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(
      pending ? { data: null, error: { message: "pending count failed" }, count: null } : { data: [], error: null, count: 0 },
    ).then(resolve);
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

  it("keeps official claims through an evidence outage — they are independently stored", async () => {
    // The claims tables are not the evidence tables. A bug_reports failure
    // must not erase Pearl Abyss's claimed fixes from the record.
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimedFixes.mockResolvedValueOnce([{ fixText: "Fixed map-open crash", category: "crash_startup" }]);
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(true);
    expect(data.claimedFixes).toEqual([{ fixText: "Fixed map-open crash", category: "crash_startup" }]);
  });

  it("leaves claims empty when their own read also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimedFixes.mockRejectedValueOnce(new Error("claims read failed"));
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(true);
    expect(data.claimedFixes).toEqual([]);
  });

  it("keeps the evidence board when only the source-signal read fails", async () => {
    // Source signals are lead context, not player evidence: their outage
    // disables the lead fields on their own and says so in the logs.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation((table: string) =>
      table === "source_signals" ? failingQuery("permission denied for table source_signals") : okQuery(),
    );
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(false);
    expect(data.sourceLeadsUnavailable).toBe(true);
    expect(data.publicFindings).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("source-signal read failed"),
      expect.anything(),
    );
  });

  it("keeps the evidence board when scanner settings are unreadable", async () => {
    // Scanner configuration is provider context, not player evidence.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation(() => okQuery());
    mocks.controlState.mockRejectedValueOnce(new Error("automation_settings unavailable"));
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(false);
    expect(data.scanner).toEqual({ paused: false, updatedAt: null });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("automation-settings read failed"),
      expect.anything(),
    );
  });

  it("keeps the evidence board when only the pending moderation count fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation((table: string) =>
      table === "bug_reports" ? pendingFailingBugReports() : okQuery(),
    );
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(false);
    expect(data.pendingCount).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("pending-count read failed"),
      expect.anything(),
    );
  });

  it("keeps the evidence board when the approved-excerpt read fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation((table: string) =>
      table === "approved_excerpts" ? failingQuery("permission denied for table approved_excerpts") : okQuery(),
    );
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(false);
    expect(data.verifiedReports).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("approved-excerpt read failed"),
      expect.anything(),
    );
  });

  it("does not fail the evidence lane when only scanner run history is unreadable", async () => {
    // Scanner history is context: its outage degrades to "no recorded run"
    // while validly read evidence keeps rendering.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation((table: string) =>
      table === "automation_runs" ? failingQuery("permission denied for table automation_runs") : okQuery(),
    );
    const { getDashboardData } = await import("@/lib/queries");
    const data = await getDashboardData();

    expect(data.evidenceUnavailable).toBe(false);
    expect(data.latestAutomationRun).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("automation-run read failed"),
      expect.anything(),
    );
  });
});
