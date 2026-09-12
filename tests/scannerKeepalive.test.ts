import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_ATTEMPT_HEADER, ScannerOperationError } from "@/lib/automation/diagnostics";

const mocks = vi.hoisted(() => ({ client: vi.fn(), run: vi.fn(), skip: vi.fn(), policy: vi.fn(), health: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.run, insertSkippedScheduledRun: mocks.skip }));
vi.mock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.policy }));
vi.mock("@/lib/automation/health.server", () => ({ getScannerAiHealth: mocks.health }));
vi.mock("@/lib/revalidate", () => ({ revalidatePublicSurfaces: mocks.revalidate }));
import { GET } from "@/app/api/cron/keepalive/route";

const id = "214ff53e-dc69-4792-90b0-ea074a137685";
const now = "2026-09-12T15:00:00.000Z";
let tableError: string | null = null;
let recent: { mode: string; status: string; started_at: string }[] = [];
const privateError = { message: "Gateway Timeout: private SQL secret=must-not-leak", code: "57014" };

function request() {
  return new Request("https://example.test/api/cron/keepalive", { headers: { authorization: "Bearer cron-test", [SCANNER_ATTEMPT_HEADER]: id } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv("CRON_SECRET", "cron-test");
  vi.stubEnv("VERCEL_ENV", "production");
  tableError = null;
  recent = [];
  mocks.client.mockReturnValue({ from: (table: string) => {
    const query = {
      select: () => query, limit: () => query, update: () => query, lt: () => query, not: () => query, gte: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "automation_runs" ? recent : [], error: tableError === table ? privateError : null }).then(resolve),
    };
    return query;
  } });
  mocks.policy.mockResolvedValue({ paused: false, minIntervalMinutes: 120 });
  mocks.health.mockResolvedValue({ state: "healthy", code: null, message: "Validated", lastSuccessAt: "2026-09-12T12:05:00.000Z" });
  mocks.run.mockResolvedValue({ status: "success", errors: [], diagnostics: [], searchQueriesUsed: 1 });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("scheduled attempt diagnostics", () => {
  it.each([
    ["issue_clusters", "database_check"], ["source_signals", "retention"], ["automation_runs", "schedule_read"],
  ])("fails closed on a returned %s error", async (table, stage) => {
    tableError = table;
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, aiHealth: null, attempt: { id, outcome: "failed", diagnostics: [{ stage, code: "database_timeout" }] } });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.skip).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("preserves the stage when run creation fails before a ledger row exists", async () => {
    mocks.run.mockRejectedValue(new ScannerOperationError("run_create", privateError));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ attempt: { id, outcome: "failed", diagnostics: [{ stage: "run_create", code: "database_timeout" }] }, aiHealth: null });
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("observes thrown policy reads without a second database read", async () => {
    mocks.policy.mockRejectedValue(privateError);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ attempt: { diagnostics: [{ stage: "policy_read", code: "database_timeout" }] } });
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each(["budget_read", "run_finalize"] as const)("keeps a returned %s failure out of successful responses", async (stage) => {
    mocks.run.mockResolvedValue({ status: "failed", errors: ["private detail"], diagnostics: [{ stage, code: "database_timeout" }] });
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, attempt: { outcome: "failed", errorCount: 1, diagnostics: [{ stage, code: "database_timeout" }] } });
    expect(JSON.stringify(body)).not.toContain("private detail");
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it("records a skip-write failure with its intended skip reason", async () => {
    mocks.policy.mockResolvedValue({ paused: true, minIntervalMinutes: 120 });
    mocks.skip.mockRejectedValue(new ScannerOperationError("skip_write", privateError));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ attempt: { outcome: "failed", skipReason: "paused", diagnostics: [{ stage: "skip_write", code: "database_timeout" }] } });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not mislabel intentional recent-run skips as failures", async () => {
    recent = [{ mode: "scheduled", status: "success", started_at: "2026-09-12T14:05:00.000Z" }];
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, attempt: { id, outcome: "skipped", errorCount: 0, skipReason: "recent_run", nextEligibleAt: "2026-09-12T16:05:00.000Z" } });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("correlates the request and ledger ID while preserving successful statistics", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, automation: { status: "success", searchQueriesUsed: 1 }, attempt: { id, outcome: "success", nextEligibleAt: "2026-09-12T17:00:00.000Z" } });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ attemptId: id }));
  });

  it("reports an unavailable health read separately after a successful scan", async () => {
    mocks.health.mockResolvedValue({ state: "unavailable", code: "ai_history_unavailable", message: "AI run history could not be read.", lastSuccessAt: null });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ ok: false, attempt: { outcome: "partial", diagnostics: [{ stage: "health_read", code: "database_unavailable" }] } });
  });
});
