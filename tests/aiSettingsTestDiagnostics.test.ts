import { describe, expect, it } from "vitest";
import { readAiDashboard, emptyConfiguration, type AiClient } from "@/lib/aiSettings/store.server";
import { INITIAL_PREVIEW_PROFILE, makePreviewTest } from "@/components/operator/ai/previewData";

const attempt = { outcome: "timeout", costState: "unknown", costUsd: null, reservedUsd: 0.001,
  timings: { headersAfterMs: 100, bodyAfterMs: null, validationMs: null, totalMs: 20_000, httpStatus: 200 } };
const timings = { preflightMs: 3000, metadataMs: 2000, reservationMs: 100, requestsMs: 20_000, settlementMs: 100,
  receiptStartedAfterMs: 23_100, settlement: "acknowledged" };
async function readBack(extra: Record<string, unknown>) {
  const profile = { ...INITIAL_PREVIEW_PROFILE, metadata: { ...INITIAL_PREVIEW_PROFILE.metadata, pricingSource: "provider" as const } };
  const saved = { ...makePreviewTest("fixture", profile, "timeout"), ...extra };
  const client = {
    from: (table: string) => {
      const query = { select: () => query, eq: () => query, order: () => query,
        limit: async () => ({ data: table === "ai_settings_state" ? [{ revision: 0, configuration: emptyConfiguration() }] :
          table === "ai_model_tests" ? [{ result: saved }] : [], error: null }) };
      return query;
    },
    rpc: async () => ({ data: { llmCostUsd: 0, uncertainUsd: 0.001, estimatedUsd: 0, openRouterCircuitOpen: false }, error: null }),
  } as unknown as AiClient;
  return (await readAiDashboard(client)).tests[0];
}

describe("private qualification diagnostics after persistence", () => {
  it("retains fixed case accounting and stage timings while dropping sensitive and unsupported fields", async () => {
    const result = await readBack({ timings: { ...timings, raw: "PRIVATE_BODY" },
      cases: [{ name: "Fixture", expected: "Fixture", detail: "Fixture", passed: false,
        attempt: { ...attempt, generationId: "PRIVATE_GENERATION", headers: "PRIVATE_CREDENTIAL",
          timings: { ...attempt.timings, rawMessage: "PRIVATE_PROMPT" } } }],
      request: "PRIVATE_REQUEST",
    });
    expect(result.timings).toEqual(timings);
    expect(result.cases[0].attempt).toEqual(attempt);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it.each([
    { ...attempt, outcome: "PRIVATE_PROVIDER_MESSAGE" },
    { ...attempt, timings: { ...attempt.timings, headersAfterMs: -1 } },
    { ...attempt, timings: { ...attempt.timings, bodyAfterMs: "PRIVATE_BODY" } },
    { ...attempt, costUsd: Infinity },
  ])("drops invalid diagnostic shapes instead of forwarding them (%j)", async (invalid) => {
    const result = await readBack({ cases: [{ name: "Fixture", expected: "Fixture", detail: "Fixture", passed: false, attempt: invalid }] });
    expect(result.cases[0].attempt).toBeUndefined();
  });

  it("does not invent stage or billing evidence for old receipts", async () => {
    const result = await readBack({});
    expect(result.timings).toBeUndefined();
    expect(result.cases.every((item) => item.attempt === undefined)).toBe(true);
  });
});
