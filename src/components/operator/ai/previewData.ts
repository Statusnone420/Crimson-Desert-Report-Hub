import { DEFAULT_AI_POLICY, type AiDashboard, type AiMetadata, type AiProfile, type AiTestCase, type AiTestResult } from "@/lib/aiSettings/types";

/** Invented design-review fixtures. Never use these as provider or billing evidence. */
export const PREVIEW_MODELS: AiMetadata[] = [
  { provider: "openrouter", id: "sample/openrouter/issue-reader", name: "Sample Issue Reader", contextWindow: 32_000, maxOutputTokens: 4_096, inputModalities: ["text"], outputModalities: ["text"], supportedParameters: ["reasoning", "structured_outputs"], reasoning: true, reasoningEfforts: ["low", "medium", "high"], reasoningRequired: false, structuredOutput: true, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, pricingSource: "unknown", pricingSupported: true, pricingIssue: null, endpoint: { tag: "sample-provider", name: "Sample provider", maxPromptTokens: null }, fetchedAt: "2026-01-01T00:00:00.000Z" },
  { provider: "openrouter", id: "sample/openrouter/backup-reader", name: "Sample Backup Reader", contextWindow: 16_000, maxOutputTokens: 2_048, inputModalities: ["text"], outputModalities: ["text"], supportedParameters: ["reasoning", "structured_outputs"], reasoning: true, reasoningEfforts: ["low", "medium"], reasoningRequired: false, structuredOutput: true, inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.5, pricingSource: "unknown", pricingSupported: true, pricingIssue: null, endpoint: { tag: "sample-provider", name: "Sample provider", maxPromptTokens: null }, fetchedAt: "2026-01-01T00:00:00.000Z" },
];

export const PREVIEW_CASES: AiTestCase[] = [
  { name: "Find the issue", passed: true, expected: "Identify a map freeze on PS5. Do not infer other platforms.", detail: "Matched the map freeze and kept the platform scoped to PS5." },
  { name: "Keep unrelated stories out", passed: true, expected: "Exclude this from issue discovery.", detail: "Classified the soundtrack comment as unrelated." },
  { name: "Match the right issue", passed: true, expected: "Match map-open crashes, not fast-travel failures.", detail: "Matched the map-open crash and excluded fast travel." },
  { name: "Leave uncertainty visible", passed: true, expected: "Leave the issue match unresolved; do not guess.", detail: "Left the vague report unresolved." },
  { name: "Preserve the patch", passed: true, expected: "Do not present this as a current-patch report.", detail: "Kept the older-patch condition." },
  { name: "Keep claims separate", passed: true, expected: "Record a developer fix claim, not player confirmation.", detail: "Recorded a developer claim without player confirmation." },
];

const profile = (metadata: AiMetadata, reasoning: AiProfile["reasoning"]): AiProfile => ({
  provider: "openrouter", modelId: metadata.id, reasoning, retention: "standard", maxOutputTokens: 1_024, connectionVersion: 1, metadata,
});

export const INITIAL_PREVIEW_PROFILE = profile(PREVIEW_MODELS[0], "high");

export function createPreviewDashboard(): AiDashboard {
  return {
    available: true,
    encryptionReady: false,
    configuration: { revision: 1, active: INITIAL_PREVIEW_PROFILE, previous: null, backup: null, policy: { ...DEFAULT_AI_POLICY } },
    connections: [{ provider: "openrouter", configured: true, source: "environment", version: 1 }],
    spend: { committedUsd: 0.24, uncertainUsd: 0.01, estimatedUsd: 0, blocked: false },
    tests: [],
    activity: [],
  };
}

export function makePreviewProfile(metadata: AiMetadata, reasoning: AiProfile["reasoning"]): AiProfile {
  return profile(metadata, reasoning);
}

export function makePreviewTest(id: string, testedProfile: AiProfile, outcome: "success" | "timeout" | "invalid"): AiTestResult {
  const cases = PREVIEW_CASES.map((item, index) => ({ ...item, passed: outcome === "success" || (outcome === "invalid" && index < 5), detail: outcome === "invalid" && index === 5 ? "Sample response used player evidence where only a developer claim was present." : item.detail }));
  return {
    id,
    profile: testedProfile,
    passed: outcome === "success",
    cases,
    outcome: outcome === "success" ? "success" : outcome === "timeout" ? "timeout" : "invalid_response",
    costUsd: outcome === "timeout" ? null : 0,
    reservedUsd: 0.01,
    costState: outcome === "timeout" ? "unknown" : "verified",
    latencyMs: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
