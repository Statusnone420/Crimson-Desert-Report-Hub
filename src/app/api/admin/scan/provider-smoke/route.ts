import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import {
  automationModelSettings,
  evaluateOpenRouterKeyBudget,
  readOpenRouterKeyBudget,
  resolveAutomationOpenRouterModel,
} from "@/lib/automation/budget";
import { extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { isVercelPreview } from "@/lib/previewGuard";
import { getAutomationControlState } from "@/lib/automation/settings";
import { automationBudgetUsd } from "@/lib/env";

const PROVIDER_SMOKE_MAX_COST_USD = 0.005;
const SYNTHETIC_CANDIDATE = {
  title: "Preview provider-route verification",
  snippet: "A synthetic PC report describes repeat frame-rate drops in a crowded city area.",
  url: "https://example.invalid/provider-route-smoke",
} as const;

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // This paid diagnostic exists only to prove a pending deployment before it
  // reaches production. It reads saved settings, but never searches or writes.
  if (!isVercelPreview()) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let model: string;
  let providerRoute: string;
  const control = await getAutomationControlState();
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  try {
    if (!apiKey) throw new Error("missing OpenRouter key");
    model = resolveAutomationOpenRouterModel(process.env.OPENROUTER_AUTOMATION_MODEL, control.modelPreset);
    const routing = automationModelSettings(model, control.modelPreset).provider;
    providerRoute = routing.only?.[0] ?? (routing.zdr ? "OpenRouter ZDR pool" : "OpenRouter provider pool");
  } catch {
    return NextResponse.json({ ok: false, error: "provider_smoke_config_invalid" }, { status: 500 });
  }

  const keyBudget = await readOpenRouterKeyBudget(apiKey);
  const monthlyLlmUsdCap = Math.min(control.monthlyLlmUsdCap, automationBudgetUsd());
  const allowance = evaluateOpenRouterKeyBudget(keyBudget, { monthlyLlmUsdCap, remainingLlmUsd: monthlyLlmUsdCap });
  if (allowance.skipReason && allowance.skipReason !== "llm_budget_capped") {
    return NextResponse.json({ ok: false, error: "provider_smoke_budget_unverified" }, { status: 503 });
  }
  if (allowance.remainingLlmUsd < PROVIDER_SMOKE_MAX_COST_USD) {
    return NextResponse.json({ ok: false, error: "provider_smoke_budget_exhausted" }, { status: 429 });
  }

  try {
    const result = await extractSignalWithOpenRouter(SYNTHETIC_CANDIDATE, {
      modelPreset: control.modelPreset,
      llmDeadlineAtMs: Date.now() + 20_000,
      llmCallsRemaining: 1,
      llmBudgetRemainingUsd: PROVIDER_SMOKE_MAX_COST_USD,
    });
    const payload = {
      ok: result.extractionProvider === "openrouter" && result.extractionModel === model,
      model,
      modelPreset: control.modelPreset,
      providerRoute,
      llmCallsUsed: result.llmCallsUsed,
      llmCostUsd: result.llmCostUsd,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    };
    if (!payload.ok) {
      return NextResponse.json({ ...payload, error: "provider_smoke_failed" }, { status: 502 });
    }
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { ok: false, error: "provider_smoke_failed", model, providerRoute },
      { status: 502 },
    );
  }
}
