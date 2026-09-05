import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  isVercelPreview: vi.fn(),
  startAutomationScan: vi.fn(),
  getAutomationControlState: vi.fn(),
  sweepStaleRuns: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.isVercelPreview }));
vi.mock("@/lib/automation/run", () => ({
  startAutomationScan: mocks.startAutomationScan,
  sweepStaleRuns: mocks.sweepStaleRuns,
}));
vi.mock("@/lib/automation/settings", () => ({
  getAutomationControlState: mocks.getAutomationControlState,
}));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});

const state = {
  statusRow: null as Record<string, unknown> | null,
  statusError: null as { message: string } | null,
};

const supabaseStub = {
  from: (table: string) => {
    if (table !== "automation_runs") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({
        eq: () => ({
          limit: async () => ({
            data: state.statusRow ? [state.statusRow] : [],
            error: state.statusError,
          }),
        }),
      }),
    };
  },
};

vi.mock("@/lib/supabase", () => ({
  createServiceClient: () => supabaseStub,
}));

import { POST } from "@/app/api/admin/scan/route";
import { GET } from "@/app/api/admin/scan/status/route";
import { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";

function scanRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function statusRequest(id?: string): Request {
  const url = new URL("http://localhost/api/admin/scan/status");
  if (id !== undefined) url.searchParams.set("id", id);
  return new Request(url.toString());
}

beforeEach(() => {
  mocks.isAdmin.mockReset().mockResolvedValue(true);
  mocks.isVercelPreview.mockReset().mockReturnValue(false);
  mocks.startAutomationScan.mockReset();
  mocks.getAutomationControlState.mockReset().mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 900,
    monthlyLlmUsdCap: 1,
    modelPreset: "deepseek_v4_flash",
    updatedAt: null,
  });
  mocks.sweepStaleRuns.mockReset().mockResolvedValue(undefined);
  mocks.revalidateTag.mockClear();
  mocks.revalidatePath.mockClear();
  mocks.after.mockReset();
  state.statusRow = null;
  state.statusError = null;
});

describe("POST /api/admin/scan", () => {
  it("401s for non-admins without starting a scan", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    const res = await POST(scanRequest({ mode: "dry_run" }));
    expect(res.status).toBe(401);
    expect(mocks.startAutomationScan).not.toHaveBeenCalled();
  });

  it("403s in Vercel preview", async () => {
    mocks.isVercelPreview.mockReturnValue(true);
    const res = await POST(scanRequest({ mode: "dry_run" }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "preview_writes_disabled" });
    expect(mocks.startAutomationScan).not.toHaveBeenCalled();
  });

  it("400s on a bad or missing mode", async () => {
    const res1 = await POST(scanRequest({ mode: "scheduled" }));
    expect(res1.status).toBe(400);
    const res2 = await POST(scanRequest({}));
    expect(res2.status).toBe(400);
    const res3 = await POST(new Request("http://localhost/api/admin/scan", { method: "POST", body: "{not json" }));
    expect(res3.status).toBe(400);
    expect(mocks.startAutomationScan).not.toHaveBeenCalled();
  });

  it("starts a scan for a valid mode, returns runId, and registers an after() callback", async () => {
    const completion = Promise.resolve({ status: "success" });
    mocks.startAutomationScan.mockResolvedValue({ status: "started", runId: "run-1", completion });

    const res = await POST(scanRequest({ mode: "dry_run" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ runId: "run-1" });
    expect(mocks.startAutomationScan).toHaveBeenCalledWith({
      mode: "dry_run",
      scannerPolicy: expect.objectContaining({
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 900,
        monthlyLlmUsdCap: 1,
      }),
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    // The registered callback must not have executed on its own.
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("409s when a scan is already running", async () => {
    mocks.startAutomationScan.mockResolvedValue({ status: "already_running", runId: null });
    const res = await POST(scanRequest({ mode: "manual" }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "scan_already_running" });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("invoking the captured after() callback revalidates for manual mode after awaiting completion", async () => {
    let resolveCompletion!: (value: unknown) => void;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    mocks.startAutomationScan.mockResolvedValue({ status: "started", runId: "run-2", completion });

    const res = await POST(scanRequest({ mode: "manual" }));
    expect(res.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;

    resolveCompletion({ status: "success" });
    await callback();

    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_DASHBOARD_TAG, "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_ISSUES_TAG, "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(CURRENT_PATCH_TAG, "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/issues");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/report");
  });

  it("invoking the captured after() callback for dry_run does not revalidate", async () => {
    let resolveCompletion!: (value: unknown) => void;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    mocks.startAutomationScan.mockResolvedValue({ status: "started", runId: "run-3", completion });

    await POST(scanRequest({ mode: "dry_run" }));
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;

    resolveCompletion({ status: "success" });
    await callback();

    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/scan/status", () => {
  it("401s for non-admins", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(401);
  });

  it("400s when id is missing", async () => {
    const res = await GET(statusRequest());
    expect(res.status).toBe(400);
  });

  it("404s for an unknown id", async () => {
    state.statusRow = null;
    const res = await GET(statusRequest("missing"));
    expect(res.status).toBe(404);
    expect(mocks.sweepStaleRuns).toHaveBeenCalledOnce();
  });

  it("200s and echoes progress for a running row", async () => {
    state.statusRow = {
      id: "run-1",
      status: "running",
      mode: "manual",
      progress: { stage: "searching", searchesDone: 1 },
      skips: [],
      errors: [],
      started_at: "2026-07-06T00:00:00.000Z",
      finished_at: null,
    };
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(state.statusRow);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("reads status in preview without updating stale rows or revalidating", async () => {
    mocks.isVercelPreview.mockReturnValue(true);
    state.statusRow = { id: "run-1", status: "success", mode: "manual", progress: null, skips: [], errors: [], started_at: "2026-07-06T00:00:00Z", finished_at: new Date().toISOString() };
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(200);
    expect(mocks.sweepStaleRuns).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("revalidates public surfaces for a manual row finished 30s ago", async () => {
    state.statusRow = {
      id: "run-1",
      status: "success",
      mode: "manual",
      progress: { stage: "done" },
      skips: [],
      errors: [],
      started_at: "2026-07-06T00:00:00.000Z",
      finished_at: new Date(Date.now() - 30 * 1000).toISOString(),
    };
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(200);
    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_DASHBOARD_TAG, "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_ISSUES_TAG, "max");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(CURRENT_PATCH_TAG, "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/issues");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/report");
  });

  it("does not revalidate for a dry_run row finished 30s ago", async () => {
    state.statusRow = {
      id: "run-1",
      status: "success",
      mode: "dry_run",
      progress: { stage: "done" },
      skips: [],
      errors: [],
      started_at: "2026-07-06T00:00:00.000Z",
      finished_at: new Date(Date.now() - 30 * 1000).toISOString(),
    };
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(200);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("500s when the read errors", async () => {
    state.statusError = { message: "boom" };
    const res = await GET(statusRequest("run-1"));
    expect(res.status).toBe(500);
  });
});
