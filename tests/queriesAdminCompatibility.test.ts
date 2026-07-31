import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchesOrExpression } from "./fixtures/postgrestOr";

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

  not(column: string, operator: string, value: unknown) {
    this.trace.operations.push(`not:${column}:${operator}:${String(value)}`);
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

  order(column: string, options?: { ascending?: boolean }) {
    // Direction is recorded: a keyset cursor paired with the wrong sort order
    // pages forever, and a trace that dropped the direction could not see it.
    this.trace.operations.push(`order:${column}:${options?.ascending === false ? "desc" : "asc"}`);
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
  it("selects the first-seen clock required by the public Community Asks fallback", async () => {
    const { getAutomationAdminData } = await import("@/lib/queries");

    await getAutomationAdminData();

    const observationRead = traces.find((trace) => trace.table === "patch_observations");
    expect(observationRead?.columns.split(",").map((column) => column.trim())).toContain("created_at");
  });

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

  // Each of these five reads used to destructure `data` only. A swallowed error
  // reaches the operator as an empty Records band, a green ACTIVE badge, or an
  // action inbox with nothing in it — "no scanner work" read off a broken
  // connection. They belong in the error boundary instead.
  const swallowedReads: { name: string; matches: (trace: QueryTrace) => boolean; message: string }[] = [
    {
      name: "source-signal window",
      matches: (trace) => trace.table === "source_signals",
      message: "source signals read failed",
    },
    {
      name: "newest-10 run history",
      matches: (trace) => trace.table === "automation_runs" && trace.operations.includes("limit:10"),
      message: "run history read failed",
    },
    {
      name: "active-run lookup",
      matches: (trace) => trace.columns === "id, status, mode, started_at",
      message: "active run read failed",
    },
    {
      name: "latest-real-run lookup",
      matches: (trace) =>
        trace.table === "automation_runs" && trace.operations.includes("in:status:success|partial|failed"),
      message: "latest run read failed",
    },
    {
      name: "latest-find lookup",
      matches: (trace) => trace.table === "automation_runs" && trace.operations.includes("in:status:success|partial"),
      message: "latest find read failed",
    },
  ];

  for (const read of swallowedReads) {
    it(`surfaces a failed ${read.name} read instead of an empty result`, async () => {
      resolveQuery = (trace) =>
        read.matches(trace) ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: [], error: null };
      const { getAutomationAdminData } = await import("@/lib/queries");

      await expect(getAutomationAdminData()).rejects.toThrow(`${read.message}: permission denied`);
    });
  }

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

  it("walks every active feedback rule past a short page without skipping a tied timestamp", async () => {
    // Three rules share one timestamp, so the tie straddles the page boundary —
    // the case a created_at-only cursor gets wrong in both directions.
    const tied = "2026-07-20T00:00:00.000Z";
    const older = "2026-07-19T00:00:00.000Z";
    const rules = [
      { id: "rule-c", created_at: tied, expires_at: null },
      { id: "rule-b", created_at: tied, expires_at: null },
      { id: "rule-a", created_at: tied, expires_at: null },
      { id: "rule-0", created_at: older, expires_at: null },
    ];
    // Stands in for the hosted PostgREST row cap: the API returns fewer rows
    // than the requested limit, so a short page must not end the walk.
    const hostedRowCap = 2;
    resolveQuery = (trace) => {
      if (trace.table !== "scanner_feedback_rules") return { data: [], error: null };
      const cursor = trace.operations.find((operation) => operation.startsWith("or:"));
      const remaining = cursor ? rules.filter((rule) => matchesOrExpression(rule, cursor.slice(3))) : rules;
      return { data: remaining.slice(0, hostedRowCap), error: null };
    };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.feedbackRules.map((rule) => rule.id)).toEqual(["rule-c", "rule-b", "rule-a", "rule-0"]);
    expect(data.feedbackLearningAvailable).toBe(true);
    const ruleTraces = traces.filter((trace) => trace.table === "scanner_feedback_rules");
    expect(ruleTraces).toHaveLength(3);
    expect(ruleTraces[0].operations).toEqual(
      expect.arrayContaining(["is:revoked_at:null", "order:created_at:desc", "order:id:desc", "limit:1000"]),
    );
    expect(ruleTraces[1].operations).toContain(
      `or:created_at.lt.${tied},and(created_at.eq.${tied},id.lt.rule-b)`,
    );
  });

  it("surfaces a feedback-rule read failure that is not a missing relation", async () => {
    resolveQuery = (trace) =>
      trace.table === "scanner_feedback_rules"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    await expect(getAutomationAdminData()).rejects.toThrow("scanner feedback rules read failed: permission denied");
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

  it("surfaces unrelated observation read failures instead of an empty desk", async () => {
    resolveQuery = (trace) =>
      trace.table === "patch_observations"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    await expect(getAutomationAdminData()).rejects.toThrow("observations read failed: permission denied");
  });

  it("treats only a missing patch_observations relation as an empty desk", async () => {
    resolveQuery = (trace) =>
      trace.table === "patch_observations"
        ? {
            data: null,
            error: {
              code: "PGRST205",
              message: "Could not find the table patch_observations in the schema cache",
            },
          }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.observations).toEqual([]);
  });

  it("scopes the decision lookup to the listed observations so no Undo falls past the cap", async () => {
    resolveQuery = (trace) =>
      trace.table === "patch_observations"
        ? {
            data: [
              { id: "observation-1", is_public: false },
              { id: "observation-2", is_public: true },
            ],
            error: null,
          }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    await getAutomationAdminData();

    const decisionTrace = traces.find(
      (trace) => trace.table === "scanner_decisions" && trace.columns.includes("observation_id"),
    );
    expect(decisionTrace).toBeDefined();
    expect(decisionTrace!.operations).toContain("in:observation_id:observation-1|observation-2");
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
