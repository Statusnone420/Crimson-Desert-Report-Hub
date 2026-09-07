import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_AI_RELEVANT_SKIP_CODES, type ScannerAiRun } from "@/lib/automation/health";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ createServiceClient: () => ({ from: mocks.from }) }));

import { getScannerAiHealth } from "@/lib/automation/health.server";

function queryResult(data: ScannerAiRun[] | null, error: unknown = null) {
  const query = {
    select: vi.fn(),
    neq: vi.fn(),
    or: vi.fn(),
    gt: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error });
  return query;
}

const run = (overrides: Partial<ScannerAiRun> = {}): ScannerAiRun => ({
  started_at: "2026-09-06T20:00:00Z",
  status: "success",
  mode: "scheduled",
  skips: [],
  llm_calls_used: 1,
  progress: { llmSucceeded: 1 },
  ...overrides,
});

describe("scanner AI health history query", () => {
  beforeEach(() => mocks.from.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("fetches finished and legacy candidates for meaningful results and validated successes", async () => {
    const meaningfulFinished = queryResult([run({ started_at: "2026-09-06T20:00:00Z", finished_at: "2026-09-06T22:00:00Z", skips: ["openrouter_no_route"], progress: { llmSucceeded: 0 } })]);
    const meaningfulLegacy = queryResult([run({ started_at: "2026-09-06T21:00:00Z", finished_at: null })]);
    const validatedFinished = queryResult([run({ finished_at: "2026-09-06T20:01:00Z" })]);
    const validatedLegacy = queryResult([]);
    mocks.from
      .mockReturnValueOnce(meaningfulFinished)
      .mockReturnValueOnce(meaningfulLegacy)
      .mockReturnValueOnce(validatedFinished)
      .mockReturnValueOnce(validatedLegacy);

    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", lastSuccessAt: "2026-09-06T21:00:00Z" });
    expect(mocks.from).toHaveBeenCalledTimes(4);
    expect(meaningfulFinished.neq.mock.calls).toEqual([
      ["status", "skipped"],
      ["status", "running"],
      ["mode", "dry_run"],
    ]);
    expect(meaningfulFinished.or).toHaveBeenCalledWith([
      "progress->>llmSucceeded.gt.0",
      ...SCANNER_AI_RELEVANT_SKIP_CODES.map((code) => `skips.cs.["${code}"]`),
    ].join(","));
    expect(meaningfulFinished.not).toHaveBeenCalledWith("finished_at", "is", null);
    expect(meaningfulFinished.order).toHaveBeenCalledWith("finished_at", { ascending: false });
    expect(meaningfulLegacy.is).toHaveBeenCalledWith("finished_at", null);
    expect(meaningfulLegacy.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(validatedFinished.gt).toHaveBeenCalledWith("progress->>llmSucceeded", 0);
    expect(validatedFinished.not).toHaveBeenCalledWith("finished_at", "is", null);
    expect(validatedFinished.order).toHaveBeenCalledWith("finished_at", { ascending: false });
    expect(validatedLegacy.is).toHaveBeenCalledWith("finished_at", null);
    expect(validatedLegacy.order).toHaveBeenCalledWith("started_at", { ascending: false });
    for (const query of [meaningfulFinished, meaningfulLegacy, validatedFinished, validatedLegacy]) {
      expect(query.limit).toHaveBeenCalledWith(1);
    }
  });

  it("fails closed when any bounded history query cannot be read", async () => {
    mocks.from
      .mockReturnValueOnce(queryResult(null, { message: "read failed" }))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([run()]))
      .mockReturnValueOnce(queryResult([]));
    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable", lastSuccessAt: null });
  });

  it("clamps raw saved controls with the environment budget ceiling", async () => {
    vi.stubEnv("AUTOMATION_BUDGET_USD_MONTHLY", "0");
    mocks.from
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([run()]))
      .mockReturnValueOnce(queryResult([]));

    expect(await getScannerAiHealth({ monthlyLlmUsdCap: 1 })).toMatchObject({ state: "idle", code: "ai_disabled" });
  });
});
