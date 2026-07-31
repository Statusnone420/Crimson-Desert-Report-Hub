import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminGuard";
import { automationModelSettings, resolveAutomationOpenRouterModel } from "@/lib/automation/budget";
import { extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { isVercelPreview } from "@/lib/previewGuard";

const PROVIDER_SMOKE_MAX_COST_USD = 0.005;
const SYNTHETIC_CANDIDATE = {
  title: "Preview provider-route verification",
  snippet: "A synthetic PC report describes repeat frame-rate drops in a crowded city area.",
  url: "https://example.invalid/provider-route-smoke",
} as const;

export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // This paid diagnostic exists only to prove a pending deployment before it
  // reaches production. It never searches, reads a source, or touches the DB.
  if (!isVercelPreview()) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let model: string;
  let providerRoute: string;
  try {
    model = resolveAutomationOpenRouterModel(process.env.OPENROUTER_AUTOMATION_MODEL);
    const routing = automationModelSettings(model).provider;
    providerRoute = routing.only?.[0] ?? (routing.zdr ? "OpenRouter ZDR pool" : "OpenRouter provider pool");
  } catch {
    return NextResponse.json({ ok: false, error: "provider_smoke_config_invalid" }, { status: 500 });
  }

  try {
    const result = await extractSignalWithOpenRouter(SYNTHETIC_CANDIDATE, {
      llmCallsRemaining: 1,
      llmBudgetRemainingUsd: PROVIDER_SMOKE_MAX_COST_USD,
    });
    const payload = {
      ok: result.extractionProvider === "openrouter" && result.extractionModel === model,
      model,
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
