import { beforeEach, describe, expect, it, vi } from "vitest";
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
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.gt.mockReturnValue(query);
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

  it("fetches the latest meaningful result and latest validated success independently", async () => {
    const meaningful = queryResult([run({ started_at: "2026-09-06T21:00:00Z", skips: ["openrouter_no_route"], progress: { llmSucceeded: 0 } })]);
    const validated = queryResult([run({ finished_at: "2026-09-06T20:01:00Z" })]);
    mocks.from.mockReturnValueOnce(meaningful).mockReturnValueOnce(validated);

    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", lastSuccessAt: "2026-09-06T20:01:00Z" });
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(meaningful.neq.mock.calls).toEqual([
      ["status", "skipped"],
      ["status", "running"],
      ["mode", "dry_run"],
    ]);
    expect(meaningful.or).toHaveBeenCalledWith([
      "progress->>llmSucceeded.gt.0",
      ...SCANNER_AI_RELEVANT_SKIP_CODES.map((code) => `skips.cs.["${code}"]`),
    ].join(","));
    expect(meaningful.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(meaningful.limit).toHaveBeenCalledWith(1);
    expect(validated.gt).toHaveBeenCalledWith("progress->>llmSucceeded", 0);
    expect(validated.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(validated.limit).toHaveBeenCalledWith(1);
  });

  it("fails closed when either bounded history query cannot be read", async () => {
    mocks.from
      .mockReturnValueOnce(queryResult(null, { message: "read failed" }))
      .mockReturnValueOnce(queryResult([run()]));
    expect(await getScannerAiHealth()).toMatchObject({ state: "unavailable", code: "ai_history_unavailable", lastSuccessAt: null });
  });
});
