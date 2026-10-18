import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCANNER_ATTEMPT_HEADER } from "@/lib/automation/diagnostics";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => unknown) => void>(),
  runColumn: vi.fn(),
  client: vi.fn(),
  run: vi.fn(),
  skip: vi.fn(),
  policy: vi.fn(),
  health: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/editorials/run.server", () => ({ runColumn: mocks.runColumn, columnFailureCode: (error: unknown) => (error instanceof Error && error.name === "ColumnNotSetUpError" ? "not_set_up" : "error") }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: mocks.client }));
vi.mock("@/lib/automation/run", () => ({ runAutomationMonitor: mocks.run, insertSkippedScheduledRun: mocks.skip }));
vi.mock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.policy }));
vi.mock("@/lib/automation/health.server", () => ({ getScannerAiHealth: mocks.health }));
vi.mock("@/lib/revalidate", () => ({ revalidatePublicSurfaces: mocks.revalidate }));

import { GET } from "@/app/api/cron/keepalive/route";
import { KEEPALIVE_MAX_MS, KEEPALIVE_SAFETY_MS, runColumnWithinDeadline, scheduleColumnAfterKeepalive } from "@/lib/editorials/hook.server";

const id = "214ff53e-dc69-4792-90b0-ea074a137685";
const NOW = "2026-10-26T14:00:00.000Z";

function request(authorization = "Bearer cron-test") {
  return new Request("https://example.test/api/cron/keepalive", { headers: { authorization, [SCANNER_ATTEMPT_HEADER]: id } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubEnv("CRON_SECRET", "cron-test");
  vi.stubEnv("VERCEL_ENV", "production");
  mocks.client.mockReturnValue({ from: () => {
    const query = { select: () => query, limit: () => query, update: () => query, lt: () => query, not: () => query, gte: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  } });
  mocks.policy.mockResolvedValue({ paused: false, minIntervalMinutes: 60 });
  mocks.health.mockResolvedValue({ state: "healthy", code: null, message: "Validated", lastSuccessAt: NOW });
  mocks.run.mockResolvedValue({ status: "success", errors: [], diagnostics: [], searchQueriesUsed: 1 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the keepalive hook", () => {
  it("leaves the scan's response exactly as it was, whatever the column does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const tasks: Promise<unknown>[] = [];
    mocks.after.mockImplementation((task) => { tasks.push(Promise.resolve().then(task)); });
    mocks.runColumn.mockRejectedValue(new Error("PRIVATE provider failure"));
    const withColumn = await GET(request());
    await Promise.all(tasks);

    mocks.after.mockImplementation(() => { throw new Error("after unavailable"); });
    const withoutColumn = await GET(request());

    expect(withColumn.status).toBe(withoutColumn.status);
    expect(await withColumn.json()).toEqual(await withoutColumn.json());
    expect(mocks.runColumn).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("PRIVATE");
  });

  it("schedules the column only for an authorized production wake", () => {
    scheduleColumnAfterKeepalive(request(), Date.now());
    expect(mocks.after).toHaveBeenCalledOnce();
    scheduleColumnAfterKeepalive(request("Bearer wrong"), Date.now());
    vi.stubEnv("VERCEL_ENV", "preview");
    scheduleColumnAfterKeepalive(request(), Date.now());
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    scheduleColumnAfterKeepalive(request(), Date.now());
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("never throws when after() is unavailable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.after.mockImplementation(() => { throw new Error("outside a request scope"); });
    expect(() => scheduleColumnAfterKeepalive(request(), Date.now())).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({ event: "column_hook_unavailable" }));
  });

  it("gives the column the keepalive's remaining time and logs only safe codes", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const started = Date.now();
    mocks.runColumn.mockResolvedValue({ status: "skipped", slot: "2026-W44:mon", reason: "paused" });
    await runColumnWithinDeadline(started);
    expect(mocks.runColumn).toHaveBeenCalledWith(expect.objectContaining({ deadlineMs: started + KEEPALIVE_MAX_MS - KEEPALIVE_SAFETY_MS }));
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "column_run", status: "skipped", slot: "2026-W44:mon", reason: "paused" }));
    const notSetUp = Object.assign(new Error("relation editorials does not exist"), { name: "ColumnNotSetUpError" });
    mocks.runColumn.mockRejectedValue(notSetUp);
    await runColumnWithinDeadline(started);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "column_run_failed", code: "not_set_up" }));
  });

  it("lets go at the deadline even if a call hangs", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.runColumn.mockReturnValue(new Promise(() => undefined));
    const done = runColumnWithinDeadline(Date.now());
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MAX_MS - KEEPALIVE_SAFETY_MS);
    await done;
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "column_run", status: "deadline" }));
  });
});
