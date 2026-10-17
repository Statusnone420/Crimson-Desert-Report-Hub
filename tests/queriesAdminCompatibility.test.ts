import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchesOrExpression } from "./fixtures/postgrestOr";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getAutomationControlState: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
  hasSupabaseServiceConfig: () => true,
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: mocks.getAutomationControlState,
}));
vi.mock("@/lib/officialPatch.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/officialPatch.server")>(),
  getCurrentPatchMetadata: mocks.getCurrentPatchMetadata,
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

  gte(column: string, value: unknown) {
    this.trace.operations.push(`gte:${column}:${String(value)}`);
    return this;
  }

  lt(column: string, value: unknown) {
    this.trace.operations.push(`lt:${column}:${String(value)}`);
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

  range(from: number, to: number) {
    this.trace.operations.push(`range:${from}:${to}`);
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    traces.push(this.trace);
    if (this.trace.table === "ai_settings_state") return Promise.resolve({ data: null,
      error: { code: "PGRST205", message: "Could not find the table 'public.ai_settings_state' in the schema cache" } }).then(onfulfilled, onrejected);
    return Promise.resolve(resolveQuery(this.trace)).then(onfulfilled, onrejected);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  traces = [];
  mocks.getCurrentPatchMetadata.mockResolvedValue({ version: "1.13.01", source: "official", publishedAt: "2026-07-08T05:51:00.000Z" });
  resolveQuery = () => ({ data: [], error: null });
  mocks.from.mockImplementation((table: string) => new FakeQuery(table));
  // This suite exercises the precise pre-migration compatibility path.
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name !== "scanner_budget_summary") throw new Error(`Unexpected fixture RPC: ${name}`);
    return { data: null, error: { code: "PGRST202", message: "Could not find public.scanner_budget_summary in the schema cache" } };
  });
  mocks.getAutomationControlState.mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 1000,
    monthlyLlmUsdCap: 2,
    modelPreset: "gpt_5_6_luna",
    updatedAt: null,
  });
});

describe("getAutomationAdminData rolling migration compatibility", () => {
  it("does not query observations against a fabricated patch when metadata is unavailable", async () => {
    mocks.getCurrentPatchMetadata.mockResolvedValue({ version: "unknown", source: "fallback", publishedAt: null });
    const { getAutomationAdminData } = await import("@/lib/queries");
    const data = await getAutomationAdminData();
    expect(data.observationPatch.source).toBe("fallback");
    expect(data.observations).toEqual([]);
    expect(traces.some((trace) => trace.table === "patch_observations")).toBe(false);
  });
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
      name: "current-month budget",
      matches: (trace) => trace.columns === "estimated_cost_usd, search_queries_used, skips, started_at",
      message: "automation spend read failed",
    },
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
      name: "latest completed finished-run lookup",
      matches: (trace) =>
        trace.table === "automation_runs" &&
        trace.operations.includes("in:status:success|partial|failed") &&
        trace.operations.includes("not:finished_at:is:null") &&
        trace.operations.includes("order:finished_at:desc"),
      message: "latest completed run read failed",
    },
    {
      name: "latest completed legacy-run lookup",
      matches: (trace) =>
        trace.table === "automation_runs" &&
        trace.operations.includes("in:status:success|partial|failed") &&
        trace.operations.includes("is:finished_at:null") &&
        trace.operations.includes("order:started_at:desc"),
      message: "latest completed legacy run read failed",
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

  it("keeps the start-ordered run for cadence and selects the later completion for the Last completed label", async () => {
    resolveQuery = (trace) => {
      if (trace.table !== "automation_runs") return { data: [], error: null };
      if (trace.operations.includes("not:finished_at:is:null")) {
        return { data: [{ id: "finished-last", started_at: "2026-09-11T10:00:00Z", finished_at: "2026-09-11T13:00:00Z" }], error: null };
      }
      if (trace.operations.includes("is:finished_at:null")) return { data: [], error: null };
      if (trace.operations.includes("in:status:success|partial|failed")) {
        return { data: [{ id: "started-last", started_at: "2026-09-11T12:00:00Z", finished_at: "2026-09-11T12:01:00Z" }], error: null };
      }
      return { data: [], error: null };
    };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.latestRealRun).toMatchObject({ id: "started-last" });
    expect(data.latestCompletedRun).toMatchObject({ id: "finished-last" });
  });

  it("falls back to the newest legacy started-at row when no completed row has finished_at", async () => {
    resolveQuery = (trace) =>
      trace.table === "automation_runs" && trace.operations.includes("is:finished_at:null")
        ? { data: [{ id: "legacy-last", started_at: "2026-09-11T12:00:00Z", finished_at: null }], error: null }
        : { data: [], error: null };
    const { getAutomationAdminData } = await import("@/lib/queries");

    const data = await getAutomationAdminData();

    expect(data.latestCompletedRun).toMatchObject({ id: "legacy-last" });
  });

  it.each([
    { legacyStart: "2026-09-11T12:00:00Z", expected: "finished-last" },
    { legacyStart: "2026-09-11T14:00:00Z", expected: "legacy-last" },
  ])("compares dated completion with the legacy clock at $legacyStart", async ({ legacyStart, expected }) => {
    resolveQuery = (trace) => {
      if (trace.table !== "automation_runs") return { data: [], error: null };
      if (trace.operations.includes("not:finished_at:is:null")) {
        return { data: [{ id: "finished-last", started_at: "2026-09-11T10:00:00Z", finished_at: "2026-09-11T13:00:00Z" }], error: null };
      }
      if (trace.operations.includes("is:finished_at:null")) {
        return { data: [{ id: "legacy-last", started_at: legacyStart, finished_at: null }], error: null };
      }
      return { data: [], error: null };
    };
    const { getAutomationAdminData } = await import("@/lib/queries");
    expect((await getAutomationAdminData()).latestCompletedRun).toMatchObject({ id: expected });
  });

  it("uses the completed and legacy filters without widening the real-run status or mode scope", async () => {
    const { getAutomationAdminData } = await import("@/lib/queries");

    expect((await getAutomationAdminData()).latestCompletedRun).toBeNull();

    const completedTrace = traces.find(
      (trace) => trace.table === "automation_runs" && trace.operations.includes("not:finished_at:is:null"),
    );
    const legacyTrace = traces.find(
      (trace) => trace.table === "automation_runs" && trace.operations.includes("is:finished_at:null"),
    );
    for (const trace of [completedTrace, legacyTrace]) {
      expect(trace?.columns).toContain("finished_at");
      expect(trace?.operations).toEqual(expect.arrayContaining([
        "neq:mode:dry_run",
        "in:status:success|partial|failed",
        "limit:1",
      ]));
    }
    expect(completedTrace?.operations).toContain("order:finished_at:desc");
    expect(legacyTrace?.operations).toContain("order:started_at:desc");
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
  it("retains dated IGDB platforms when the newest lookup is absent and Twitch is healthy", async () => {
    resolveQuery = () => ({ data: [
      { captured_at: "2026-09-24T12:00:00Z", igdb_status: "absent", igdb_platforms: [], twitch_status: "ok", twitch_complete: true, twitch_live_streams: 24, twitch_live_viewers: 219 },
      { captured_at: "2026-09-23T14:00:00Z", igdb_status: "ok", igdb_slug: "crimson-desert", igdb_platforms: ["PC", "PlayStation 5"], twitch_status: "ok", twitch_complete: true, twitch_live_streams: 20, twitch_live_viewers: 180 },
    ], error: null });
    const { readPlatformContext } = await import("@/lib/queries");
    await expect(readPlatformContext({ from: mocks.from } as never, new Date("2026-09-24T12:30:00Z"))).resolves.toMatchObject({
      capturedAt: "2026-09-24T12:00:00Z", igdbStatus: "absent", igdbCapturedAt: "2026-09-23T14:00:00Z",
      platforms: ["PC", "PlayStation 5"], igdbUrl: "https://www.igdb.com/games/crimson-desert", liveViewers: 219,
    });
  });

  it("retrieves the last listed platforms beyond the bounded Twitch history", async () => {
    resolveQuery = (trace) => ({ data: trace.operations.includes("eq:igdb_status:ok")
      ? [{ captured_at: "2026-09-01T14:00:00Z", igdb_status: "ok", igdb_platforms: ["PC"], igdb_slug: "crimson-desert" }]
      : [{ captured_at: "2026-09-24T12:00:00Z", igdb_status: "ok", igdb_platforms: [] }], error: null });
    const { readPlatformContext } = await import("@/lib/queries");
    await expect(readPlatformContext({ from: mocks.from } as never)).resolves.toMatchObject({
      igdbStatus: "ok", igdbCapturedAt: "2026-09-01T14:00:00Z", platforms: ["PC"],
    });
    expect(traces.some((trace) => trace.operations.includes("neq:igdb_platforms:{}") && trace.operations.includes("limit:1"))).toBe(true);
  });

  it("surfaces a failed historical metadata read instead of reporting an empty platform list", async () => {
    resolveQuery = (trace) => trace.operations.includes("eq:igdb_status:ok")
      ? { data: null, error: { code: "42501", message: "permission denied" } }
      : { data: [{ captured_at: "2026-09-24T12:00:00Z", igdb_status: "absent", igdb_platforms: [] }], error: null };
    const { readPlatformContext } = await import("@/lib/queries");
    await expect(readPlatformContext({ from: mocks.from } as never)).rejects.toThrow("IGDB history read failed: permission denied");
  });

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

  it("reads Twitch history from complete captures alone, so hourly failure rows cannot crowd it out", async () => {
    // A Twitch outage stores a failure row every hour; 96 of them fill the newest-row read.
    const failures = Array.from({ length: 96 }, (_, hour) => ({
      captured_at: new Date(Date.parse("2026-07-23T12:00:00.000Z") - hour * 3_600_000).toISOString(),
      igdb_status: "error", igdb_platforms: [], twitch_status: "error",
      twitch_live_streams: null, twitch_live_viewers: null, twitch_complete: null,
    }));
    const capture = { captured_at: "2026-07-19T08:00:00.000Z", twitch_status: "ok",
      twitch_live_streams: 40, twitch_live_viewers: 400, twitch_complete: true };
    resolveQuery = (trace) => ({ error: null, data: trace.operations.includes("eq:twitch_status:ok") ? [capture]
      : trace.operations.includes("eq:igdb_status:ok") ? [] : failures });
    const { readPlatformContext } = await import("@/lib/queries");

    await expect(readPlatformContext({ from: mocks.from } as never, new Date("2026-07-23T12:30:00.000Z"))).resolves.toMatchObject({
      twitchStatus: "error",
      twitchHistory: [{ capturedAt: "2026-07-19T08:00:00.000Z", liveStreams: 40, liveViewers: 400 }],
    });
    expect(traces.find((trace) => trace.operations.includes("eq:twitch_status:ok"))?.operations)
      .toEqual(["eq:twitch_status:ok", "eq:twitch_complete:true", "order:captured_at:desc", "limit:192"]);
  });

  it("keeps the latest Twitch capture in a UTC hour when overlapping captures stored two", async () => {
    const capture = (capturedAt: string, streams: number, viewers: number) => ({ captured_at: capturedAt,
      twitch_status: "ok", twitch_live_streams: streams, twitch_live_viewers: viewers, twitch_complete: true });
    resolveQuery = () => ({ error: null, data: [
      capture("2026-07-23T12:01:10.000Z", 51, 210),
      capture("2026-07-23T12:00:40.000Z", 50, 205),
      capture("2026-07-23T11:59:50.000Z", 49, 200),
      capture("2026-07-23T08:00:00.000Z", 65, 320),
    ] });
    const { readPlatformContext } = await import("@/lib/queries");

    await expect(readPlatformContext({ from: mocks.from } as never, new Date("2026-07-23T12:30:00.000Z"))).resolves.toMatchObject({
      liveViewers: 210,
      twitchHistory: [
        { capturedAt: "2026-07-23T08:00:00.000Z", liveStreams: 65, liveViewers: 320 },
        { capturedAt: "2026-07-23T11:59:50.000Z", liveStreams: 49, liveViewers: 200 },
        { capturedAt: "2026-07-23T12:01:10.000Z", liveStreams: 51, liveViewers: 210 },
      ],
    });
  });

  it("reads older pages until it holds 96 hours when overlapping captures repeat in each hour", async () => {
    // Three captures in each of the newest 64 hours fill the first page.
    const start = Date.parse("2026-07-23T12:00:00.000Z");
    const capture = (hour: number, seconds: number) => ({
      captured_at: new Date(start - hour * 3_600_000 + seconds * 1_000).toISOString(),
      twitch_status: "ok", twitch_live_streams: hour, twitch_live_viewers: seconds, twitch_complete: true });
    const firstPage = Array.from({ length: 64 }, (_, hour) => [30, 20, 10].map((seconds) => capture(hour, seconds))).flat();
    const secondPage = Array.from({ length: 36 }, (_, index) => capture(64 + index, 10));
    resolveQuery = (trace) => ({ error: null, data: !trace.operations.includes("eq:twitch_status:ok") ? [firstPage[0]]
      : trace.operations.some((operation) => operation.startsWith("lt:")) ? secondPage : firstPage });
    const { readPlatformContext } = await import("@/lib/queries");

    const context = await readPlatformContext({ from: mocks.from } as never, new Date("2026-07-23T12:30:00.000Z"));
    expect(context?.twitchHistory).toHaveLength(96);
    expect(context?.twitchHistory[0]).toEqual({ capturedAt: "2026-07-19T13:00:10.000Z", liveStreams: 95, liveViewers: 10 });
    expect(context?.twitchHistory.at(-1)).toEqual({ capturedAt: "2026-07-23T12:00:30.000Z", liveStreams: 0, liveViewers: 30 });
    expect(traces.filter((trace) => trace.operations.includes("eq:twitch_status:ok"))
      .map((trace) => trace.operations.find((operation) => operation.startsWith("lt:")) ?? null))
      .toEqual([null, `lt:captured_at:${firstPage.at(-1)!.captured_at}`]);
  });

  it("stops paging Twitch history when a page does not move past the last one", async () => {
    const start = Date.parse("2026-07-23T12:00:00.000Z");
    const page = Array.from({ length: 192 }, (_, index) => ({
      captured_at: new Date(start - Math.floor(index / 3) * 3_600_000 + (2 - (index % 3)) * 1_000).toISOString(),
      twitch_status: "ok", twitch_live_streams: 1, twitch_live_viewers: 1, twitch_complete: true }));
    // A backend that ignored the cursor would answer every page with the first one.
    resolveQuery = () => ({ error: null, data: page });
    const { readPlatformContext } = await import("@/lib/queries");

    const context = await readPlatformContext({ from: mocks.from } as never, new Date("2026-07-23T12:30:00.000Z"));
    expect(context?.twitchHistory).toHaveLength(64);
    expect(traces.filter((trace) => trace.operations.includes("eq:twitch_status:ok"))).toHaveLength(2);
  });

  it("surfaces a failed Twitch history read instead of reporting no captures", async () => {
    resolveQuery = (trace) => trace.operations.includes("eq:twitch_status:ok")
      ? { data: null, error: { code: "42501", message: "permission denied" } }
      : { data: [{ captured_at: "2026-09-24T12:00:00Z", igdb_status: "ok", igdb_slug: "crimson-desert", igdb_platforms: ["PC"],
          twitch_status: "ok", twitch_live_streams: 24, twitch_live_viewers: 219, twitch_complete: true }], error: null };
    const { readPlatformContext } = await import("@/lib/queries");

    await expect(readPlatformContext({ from: mocks.from } as never)).rejects.toThrow("Twitch history read failed: permission denied");
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
