import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  isVercelPreview: vi.fn(),
  resolveAutomationOpenRouterModel: vi.fn(),
  automationModelSettings: vi.fn(),
  extractSignalWithOpenRouter: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("@/lib/previewGuard", () => ({ isVercelPreview: mocks.isVercelPreview }));
vi.mock("@/lib/automation/budget", () => ({
  resolveAutomationOpenRouterModel: mocks.resolveAutomationOpenRouterModel,
  automationModelSettings: mocks.automationModelSettings,
}));
vi.mock("@/lib/automation/extract", () => ({
  extractSignalWithOpenRouter: mocks.extractSignalWithOpenRouter,
}));

import { POST } from "@/app/api/admin/scan/provider-smoke/route";

beforeEach(() => {
  mocks.isAdmin.mockReset().mockResolvedValue(true);
  mocks.isVercelPreview.mockReset().mockReturnValue(true);
  mocks.resolveAutomationOpenRouterModel.mockReset().mockReturnValue("openai/gpt-5.6-luna");
  mocks.automationModelSettings.mockReset().mockReturnValue({ provider: { only: ["OpenAI"] } });
  mocks.extractSignalWithOpenRouter.mockReset().mockResolvedValue({
    extractionProvider: "openrouter",
    extractionModel: "openai/gpt-5.6-luna",
    llmCallsUsed: 1,
    llmCostUsd: 0.00042,
  });
});

describe("POST /api/admin/scan/provider-smoke", () => {
  it("401s before inspecting preview state or calling the provider", async () => {
    mocks.isAdmin.mockResolvedValue(false);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.isVercelPreview).not.toHaveBeenCalled();
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
      providerRoute: "OpenAI",
      llmCallsUsed: 1,
      llmCostUsd: 0.00042,
    });
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledOnce();
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      {
        title: "Preview provider-route verification",
        snippet: "A synthetic PC report describes repeat frame-rate drops in a crowded city area.",
        url: "https://example.invalid/provider-route-smoke",
      },
      { llmCallsRemaining: 1, llmBudgetRemainingUsd: 0.005 },
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
