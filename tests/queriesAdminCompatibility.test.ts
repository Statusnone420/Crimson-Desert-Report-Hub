import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getAutomationControlState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from }),
  hasSupabaseServiceConfig: () => true,
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: mocks.getAutomationControlState,
}));

type QueryTrace = {
  table: string;
  columns: string;
  operations: string[];
};

let traces: QueryTrace[] = [];
let resolveQuery: (trace: QueryTrace) => { data: unknown[] | null; error: Record<string, unknown> | null };

class FakeQuery {
  private readonly trace: QueryTrace;

  constructor(table: string) {
    this.trace = { table, columns: "", operations: [] };
  }

  select(columns = "") {
    this.trace.columns = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.trace.operations.push(`eq:${column}:${String(value)}`);
    return this;
  }

  gt(column: string, value: unknown) {
    this.trace.operations.push(`gt:${column}:${String(value)}`);
    return this;
  }

  is(column: string, value: unknown) {
    this.trace.operations.push(`is:${column}:${String(value)}`);
    return this;
  }

  neq(column: string, value: unknown) {
    this.trace.operations.push(`neq:${column}:${String(value)}`);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.trace.operations.push(`in:${column}:${values.join("|")}`);
    return this;
  }

  or(expression: string) {
    this.trace.operations.push(`or:${expression}`);
    return this;
  }

  order(column: string) {
    this.trace.operations.push(`order:${column}`);
    return this;
  }

  limit(count: number) {
    this.trace.operations.push(`limit:${count}`);
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    traces.push(this.trace);
    return Promise.resolve(resolveQuery(this.trace)).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  traces = [];
  resolveQuery = () => ({ data: [], error: null });
  mocks.from.mockImplementation((table: string) => new FakeQuery(table));
  mocks.getAutomationControlState.mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 1000,
    monthlyLlmUsdCap: 2,
    modelPreset: "deepseek_v4_flash",
    updatedAt: null,
  });
});

describe("getAutomationAdminData rolling migration compatibility", () => {
  it("retries a legacy rejected-candidate projection and normalizes feedback fields", async () => {
    resolveQuery = (trace) => {
      if (trace.table !== "automation_rejected_candidates") return { data: [], error: null };
      if (trace.columns.includes("decision_id")) {
        return {
          data: null,
          error: {
            code: "PGRST204",
            message:
              "Could not find the decision_id column of automation_rejected_candidates in the schema cache",
          },
        };
      }
      return {
        data: [
          {
            id: "candidate-one",
            run_id: null,
            title: "Candidate",
            url: "https://example.com/candidate",
            source_domain: "example.com",
            source_published_at: null,
            snippet: "Candidate text",
            reason: "off_topic",
            created_at: "2026-07-22T12:00:00Z",
            expires_at: "2026-07-29T12:00:00Z",
            rescued_at: null,
          },
        ],
        error: null,
      };
    };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.rejectedCandidates).toEqual([
      expect.objectContaining({ id: "candidate-one", decision_id: null, feedback_rule_id: null }),
    ]);
    expect(traces.filter((trace) => trace.table === "automation_rejected_candidates")).toHaveLength(2);
  });

  it("surfaces unrelated rejected-candidate read failures", async () => {
    resolveQuery = (trace) =>
      trace.table === "automation_rejected_candidates"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    await expect(getAutomationAdminData()).rejects.toThrow("rejected candidates read failed: permission denied");
    expect(traces.filter((trace) => trace.table === "automation_rejected_candidates")).toHaveLength(1);
  });

  it("treats only a missing feedback-rules relation as the legacy empty state", async () => {
    resolveQuery = (trace) =>
      trace.table === "scanner_feedback_rules"
        ? {
            data: null,
            error: {
              code: "PGRST205",
              message: "Could not find the table scanner_feedback_rules in the schema cache",
            },
          }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.feedbackRules).toEqual([]);
    expect(data.feedbackLearningAvailable).toBe(false);
  });

  it("enables scanner-learning controls when the feedback schema is available", async () => {
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.feedbackLearningAvailable).toBe(true);
  });

  it("loads every active feedback rule so each enforced lesson keeps an Undo path", async () => {
    const { getAutomationAdminData } = await import("@/lib/queries");

    await getAutomationAdminData();

    const ruleTrace = traces.find((trace) => trace.table === "scanner_feedback_rules");
    expect(ruleTrace).toBeDefined();
    expect(ruleTrace!.operations).toEqual(expect.arrayContaining([
      "is:revoked_at:null",
      expect.stringMatching(/^or:expires_at\.is\.null,expires_at\.gt\./),
    ]));
    expect(ruleTrace!.operations).not.toContain("limit:50");
  });

  it("filters decided and rescued candidates before the thirty-row window", async () => {
    const { getAutomationAdminData } = await import("@/lib/queries");

    await getAutomationAdminData();

    const candidateTrace = traces.find(
      (trace) => trace.table === "automation_rejected_candidates" && trace.columns.includes("decision_id"),
    );
    expect(candidateTrace?.operations).toEqual(expect.arrayContaining([
      "is:rescued_at:null",
      "is:decision_id:null",
      "is:feedback_rule_id:null",
    ]));
    const limitIndex = candidateTrace!.operations.indexOf("limit:30");
    expect(candidateTrace!.operations.indexOf("is:decision_id:null")).toBeLessThan(limitIndex);
  });

  it("surfaces unrelated feedback-rule read failures", async () => {
    resolveQuery = (trace) =>
      trace.table === "scanner_feedback_rules"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    await expect(getAutomationAdminData()).rejects.toThrow("scanner feedback rules read failed: permission denied");
  });
});

describe("public platform reader rolling migration compatibility", () => {
  it.each([
    ["steam_pulse_snapshots", "readSteamPulse", []],
    ["platform_context_snapshots", "readPlatformContext", null],
  ] as const)("treats only a missing %s relation as unavailable", async (table, readerName, expected) => {
    resolveQuery = (trace) =>
      trace.table === table
        ? {
            data: null,
            error: {
              code: "PGRST205",
              message: `Could not find the table ${table} in the schema cache`,
            },
          }
        : { data: [], error: null };
    const queries = await import("@/lib/queries");

    await expect(queries[readerName]({ from: mocks.from } as never)).resolves.toEqual(expected);
  });

  it("hides stale Twitch aggregates while keeping durable IGDB metadata", async () => {
    resolveQuery = (trace) => trace.table === "platform_context_snapshots"
      ? {
          data: [{
            captured_at: "2026-07-22T08:00:00.000Z",
            igdb_status: "ok",
            igdb_first_release_at: "2026-07-20T00:00:00.000Z",
            igdb_platforms: ["PC"],
            twitch_status: "ok",
            twitch_live_streams: 12,
            twitch_live_viewers: 345,
            twitch_complete: true,
          }],
          error: null,
        }
      : { data: [], error: null };
    const { readPlatformContext } = await import("@/lib/queries");

    await expect(readPlatformContext(
      { from: mocks.from } as never,
      new Date("2026-07-22T12:00:00.000Z"),
    )).resolves.toEqual(expect.objectContaining({
      releaseAt: "2026-07-20T00:00:00.000Z",
      platforms: ["PC"],
      twitchStatus: "stale",
      liveStreams: null,
      liveViewers: null,
      twitchComplete: null,
    }));
  });

  it("returns actual complete Twitch snapshots in chronological order with a canonical IGDB link", async () => {
    resolveQuery = (trace) => trace.table === "platform_context_snapshots"
      ? {
          data: [
            {
              captured_at: "2026-07-23T11:30:00.000Z",
              igdb_status: "ok",
              igdb_slug: "crimson-desert",
              igdb_first_release_at: "2026-07-20T00:00:00.000Z",
              igdb_platforms: ["PC", "PlayStation 5"],
              twitch_status: "ok",
              twitch_live_streams: 53,
              twitch_live_viewers: 205,
              twitch_complete: true,
            },
            {
              captured_at: "2026-07-23T08:00:00.000Z",
              igdb_status: "ok",
              igdb_slug: "crimson-desert",
              igdb_first_release_at: "2026-07-20T00:00:00.000Z",
              igdb_platforms: ["PC", "PlayStation 5"],
              twitch_status: "ok",
              twitch_live_streams: 65,
              twitch_live_viewers: 320,
              twitch_complete: true,
            },
          ],
          error: null,
        }
      : { data: [], error: null };
    const { readPlatformContext } = await import("@/lib/queries");

    await expect(readPlatformContext(
      { from: mocks.from } as never,
      new Date("2026-07-23T12:00:00.000Z"),
    )).resolves.toEqual(expect.objectContaining({
      igdbUrl: "https://www.igdb.com/games/crimson-desert",
      twitchHistory: [
        { capturedAt: "2026-07-23T08:00:00.000Z", liveStreams: 65, liveViewers: 320 },
        { capturedAt: "2026-07-23T11:30:00.000Z", liveStreams: 53, liveViewers: 205 },
      ],
    }));
  });

  it("isolates an optional Pulse failure without discarding the healthy lane", async () => {
    resolveQuery = (trace) => trace.table === "steam_pulse_snapshots"
      ? { data: null, error: { code: "42501", message: "permission denied" } }
      : trace.table === "platform_context_snapshots"
        ? { data: [], error: null }
        : { data: [], error: null };
    const { readPublicPulseContext } = await import("@/lib/queries");

    await expect(readPublicPulseContext({ from: mocks.from } as never)).resolves.toEqual({
      steamPulse: [],
      platformContext: null,
      pulseReadFailures: ["steam"],
    });
  });

  it.each([
    ["steam_pulse_snapshots", "readSteamPulse", "Steam Pulse read failed"],
    ["platform_context_snapshots", "readPlatformContext", "Platform context read failed"],
  ] as const)("surfaces unrelated %s failures", async (table, readerName, message) => {
    resolveQuery = (trace) =>
      trace.table === table
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null };
    const queries = await import("@/lib/queries");

    await expect(queries[readerName]({ from: mocks.from } as never)).rejects.toThrow(
      `${message}: permission denied`,
    );
  });
});
