import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  isVercelPreview: vi.fn(),
  resolveAutomationOpenRouterModel: vi.fn(),
  automationModelSettings: vi.fn(),
  getAutomationControlState: vi.fn(),
  readOpenRouterKeyBudget: vi.fn(),
  extractSignalWithOpenRouter: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.isVercelPreview }));
vi.mock("@/lib/automation/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/budget")>();
  return {
    ...actual,
    resolveAutomationOpenRouterModel: mocks.resolveAutomationOpenRouterModel,
    automationModelSettings: mocks.automationModelSettings,
    readOpenRouterKeyBudget: mocks.readOpenRouterKeyBudget,
  };
});
vi.mock("@/lib/automation/extract", () => ({
  extractSignalWithOpenRouter: mocks.extractSignalWithOpenRouter,
}));
vi.mock("@/lib/automation/settings", () => ({ getAutomationControlState: mocks.getAutomationControlState }));

import { POST } from "@/app/api/admin/scan/provider-smoke/route";

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  mocks.isAdmin.mockReset().mockResolvedValue(true);
  mocks.isVercelPreview.mockReset().mockReturnValue(true);
  mocks.resolveAutomationOpenRouterModel.mockReset().mockReturnValue("openai/gpt-5.6-luna");
  mocks.automationModelSettings.mockReset().mockReturnValue({ provider: { only: ["OpenAI"] } });
  mocks.getAutomationControlState.mockReset().mockResolvedValue({
    paused: false,
    minIntervalMinutes: 60,
    scheduledSearchCreditsPerRun: 1,
    monthlyTavilyCreditCap: 900,
    monthlyLlmUsdCap: 1,
    modelPreset: "gpt_5_6_luna",
    updatedAt: null,
  });
  mocks.readOpenRouterKeyBudget.mockReset().mockResolvedValue({
    limitUsd: 1,
    limitRemainingUsd: 0.75,
    limitReset: "monthly",
    usageMonthlyUsd: 0.25,
  });
  mocks.extractSignalWithOpenRouter.mockReset().mockResolvedValue({
    extractionProvider: "openrouter",
    extractionModel: "openai/gpt-5.6-luna",
    llmCallsUsed: 1,
    llmCostUsd: 0.00042,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/scan/provider-smoke", () => {
  it("401s before inspecting preview state or calling the provider", async () => {
    mocks.isAdmin.mockResolvedValue(false);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.isVercelPreview).not.toHaveBeenCalled();
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it("refuses an unbounded or unverifiable OpenRouter key before generation", async () => {
    mocks.readOpenRouterKeyBudget.mockResolvedValue({
      limitUsd: null,
      limitRemainingUsd: null,
      limitReset: null,
      usageMonthlyUsd: 0,
    });

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "provider_smoke_budget_unverified" });
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it("refuses a key whose provider-enforced limit exceeds the app's monthly cap", async () => {
    mocks.readOpenRouterKeyBudget.mockResolvedValue({
      limitUsd: 10,
      limitRemainingUsd: 9.5,
      limitReset: "monthly",
      usageMonthlyUsd: 0.5,
    });

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "provider_smoke_budget_unverified" });
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it.each([
    ["daily", { limitUsd: 1, limitRemainingUsd: 1, limitReset: "daily", usageMonthlyUsd: 0 }],
    ["unreadable", null],
  ])("refuses a %s key limit before generation", async (_label, keyBudget) => {
    mocks.readOpenRouterKeyBudget.mockResolvedValue(keyBudget);

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "provider_smoke_budget_unverified" });
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it("refuses generation when the aggregate provider budget has less than one request ceiling left", async () => {
    mocks.readOpenRouterKeyBudget.mockResolvedValue({
      limitUsd: 1,
      limitRemainingUsd: 0.004,
      limitReset: "monthly",
      usageMonthlyUsd: 0.996,
    });

    const response = await POST();

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "provider_smoke_budget_exhausted" });
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it("is unavailable outside Vercel preview", async () => {
    mocks.isVercelPreview.mockReturnValue(false);

    const response = await POST();

    expect(response.status).toBe(404);
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });

  it("runs exactly one synthetic provider call with a half-cent ceiling", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      model: "openai/gpt-5.6-luna",
      modelPreset: "gpt_5_6_luna",
      providerRoute: "OpenAI",
      llmCallsUsed: 1,
      llmCostUsd: 0.00042,
    });
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledOnce();
    expect(mocks.getAutomationControlState).toHaveBeenCalledOnce();
    expect(mocks.resolveAutomationOpenRouterModel).toHaveBeenCalledWith(undefined, "gpt_5_6_luna");
    expect(mocks.automationModelSettings).toHaveBeenCalledWith("openai/gpt-5.6-luna", "gpt_5_6_luna");
    expect(mocks.readOpenRouterKeyBudget).toHaveBeenCalledWith(expect.any(String));
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      {
        title: "Preview provider-route verification",
        snippet: "A synthetic PC report describes repeat frame-rate drops in a crowded city area.",
        url: "https://example.invalid/provider-route-smoke",
      },
      expect.objectContaining({
        modelPreset: "gpt_5_6_luna",
        llmCallsRemaining: 1,
        llmBudgetRemainingUsd: 0.005,
        llmDeadlineAtMs: expect.any(Number),
      }),
    );
  });

  it("surfaces deterministic fallback as a failed smoke instead of a pass", async () => {
    mocks.extractSignalWithOpenRouter.mockResolvedValue({
      extractionProvider: "deterministic",
      extractionModel: null,
      llmCallsUsed: 1,
      llmCostUsd: 0,
      fallbackReason: "openrouter_no_route",
    });

    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "provider_smoke_failed",
      model: "openai/gpt-5.6-luna",
      modelPreset: "gpt_5_6_luna",
      providerRoute: "OpenAI",
      llmCallsUsed: 1,
      llmCostUsd: 0,
      fallbackReason: "openrouter_no_route",
    });
  });

  it("fails closed when the configured model is not approved", async () => {
    mocks.resolveAutomationOpenRouterModel.mockImplementation(() => {
      throw new Error("unapproved");
    });

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "provider_smoke_config_invalid" });
    expect(mocks.extractSignalWithOpenRouter).not.toHaveBeenCalled();
  });
});
