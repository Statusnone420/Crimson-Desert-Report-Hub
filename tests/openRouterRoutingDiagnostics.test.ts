import { describe, expect, it, vi } from "vitest";
import { isOpenRouterRoutingRefusal, openRouterRoutingRefusalCategory } from "@/lib/automation/budget";
import { appendOpenRouterDiagnostics, type OpenRouterDiagnostic } from "@/lib/automation/openRouterDiagnostics";
import { parseScannerAiEvidence, scannerAiEvidence, scannerAiEvidenceLines } from "@/lib/automation/openRouterReadout";
import { extractSignalWithOpenRouter } from "@/lib/automation/extract";
import { mapClaimToClusterWithOpenRouter } from "@/lib/automation/claimMapping";

const messages = [
  ["No endpoints found that can handle the requested price.", "price"],
  ["No endpoints found matching your data policy (Zero data retention).", "privacy"],
  ["No endpoints found that can handle the requested parameters.", "required_parameters"],
  ["No endpoints found matching your provider restrictions.", "provider_restriction"],
  ["No allowed providers are available.", "unknown"],
  ["No endpoints found.", "unknown"],
  ["No endpoints found matching your price and privacy filters.", "unknown"],
  ["No endpoints found that can handle the requested price. PRIVATE key, prompt, headers, body", "unknown"],
] as const;

describe("private routing refusal categories", () => {
  it.each(messages)("keeps only the supported category for %s", (message, category) => {
    const body = { error: { message, metadata: { headers: "PRIVATE", request: "PRIVATE" } } };
    expect(openRouterRoutingRefusalCategory(404, body)).toBe(category);
    expect(isOpenRouterRoutingRefusal(404, body)).toBe(true);
    expect(openRouterRoutingRefusalCategory(404, { ...body, id: "gen-private" })).toBe("unknown");
    expect(isOpenRouterRoutingRefusal(404, { ...body, id: "gen-private" })).toBe(false);
    expect(openRouterRoutingRefusalCategory(502, body)).toBe("unknown");
    expect(isOpenRouterRoutingRefusal(502, body)).toBe(false);
  });

  it("never turns an arbitrary 404 into verified zero cost", () => {
    for (const body of [null, {}, { error: { message: "Not found" } }, { error: { message: "Price unavailable" } }]) {
      expect(isOpenRouterRoutingRefusal(404, body)).toBe(false);
      expect(openRouterRoutingRefusalCategory(404, body)).toBe("unknown");
    }
  });

  it.each(["price", "privacy", "required_parameters", "provider_restriction", "unknown"] as const)(
    "retains %s through persisted progress and private receipt parsing", (routingRefusal) => {
      const raw = { code: "request_http_failure", elapsedMs: 20, httpStatus: 404, attempts: 1, routingRefusal,
        message: "PRIVATE", credentials: "PRIVATE", headers: "PRIVATE", prompts: "PRIVATE", body: "PRIVATE" };
      const progress = JSON.parse(JSON.stringify({ openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, [raw as OpenRouterDiagnostic]) }));
      const evidence = parseScannerAiEvidence(JSON.parse(JSON.stringify(scannerAiEvidence(progress, 1, ["openrouter_no_route"]))));
      expect(evidence?.diagnostic?.routingRefusal).toBe(routingRefusal);
      expect(scannerAiEvidenceLines(evidence!).join(" ")).toContain(`Routing refusal category: ${routingRefusal.replaceAll("_", " ")}`);
      expect(JSON.stringify(evidence)).not.toContain("PRIVATE");
      expect(evidence?.costState).toBe("unknown"); // Category cannot establish accounting.
    });

  it("keeps unrecognized categories unknown and strips categories from unrelated records", () => {
    const base = { code: "request_http_failure" as const, elapsedMs: 0, httpStatus: 404, attempts: 1 };
    // A plain 404 without a verified refusal gets no routing category at all.
    expect(appendOpenRouterDiagnostics(undefined, [base])[0]).not.toHaveProperty("routingRefusal");
    for (const routingRefusal of ["PRIVATE", { message: "PRIVATE" }, ["price"]]) {
      expect(appendOpenRouterDiagnostics(undefined, [{ ...base, routingRefusal } as OpenRouterDiagnostic])[0])
        .toEqual({ ...base, routingRefusal: "unknown" });
    }
    expect(appendOpenRouterDiagnostics(undefined, [{ ...base, code: "request_timeout", routingRefusal: "price" }])[0])
      .not.toHaveProperty("routingRefusal");
    expect(appendOpenRouterDiagnostics(undefined, [{ ...base, httpStatus: 500, routingRefusal: "price" }])[0])
      .not.toHaveProperty("routingRefusal");
  });

  it.each(messages)("extraction and mapping diagnostics do not change outcomes, costs or retries: %s", async (message, category) => {
    const candidate = { title: "Game crashes", snippet: "The game crashes when opening the map.", url: "https://example.invalid/report" };
    const claim = { fixText: "Fixed a crash when opening the map.", category: "crash_startup" as const };
    const clusters = [{ id: "map", slug: "map-crash", title: "Map crash", category: "crash_startup" as const, description: "Crashes when opening the map." }];
    const options = { env: { OPENROUTER_API_KEY: "PRIVATE" }, llmCallsRemaining: 3, llmBudgetRemainingUsd: 1 };
    const settle = vi.fn(async () => {});
    const begin = vi.fn(async () => ({ settle }));
    const paidGuard = { deadlineAtMs: Date.now() + 20_000, begin };
    const fetcher = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: { message } }) }));
    const diagnostics: OpenRouterDiagnostic[] = [];
    const onDiagnostic = (item: OpenRouterDiagnostic) => { diagnostics.push(item); };
    const withoutExtraction = await extractSignalWithOpenRouter(candidate, { ...options, fetcher, paidGuard });
    const withExtraction = await extractSignalWithOpenRouter(candidate, { ...options, fetcher, paidGuard, onDiagnostic });
    const withoutMapping = await mapClaimToClusterWithOpenRouter(claim, clusters, { ...options, fetcher, paidGuard });
    const withMapping = await mapClaimToClusterWithOpenRouter(claim, clusters, { ...options, fetcher, paidGuard, onDiagnostic });
    expect(withExtraction).toEqual(withoutExtraction);
    expect(withMapping).toEqual(withoutMapping);
    expect(withExtraction).toMatchObject({ fallbackReason: "openrouter_no_route", llmCallsUsed: 1, llmCostUsd: 0 });
    expect(withMapping).toMatchObject({ skipReason: "openrouter_no_route", llmCallsUsed: 1, llmCostUsd: 0 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(begin).toHaveBeenCalledTimes(4);
    expect(begin.mock.calls[0]).toEqual(begin.mock.calls[1]);
    expect(begin.mock.calls[2]).toEqual(begin.mock.calls[3]);
    expect(settle).toHaveBeenCalledTimes(4);
    expect(settle.mock.calls[0]).toEqual(settle.mock.calls[1]);
    expect(settle.mock.calls[2]).toEqual(settle.mock.calls[3]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((item) => item.routingRefusal === category)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE");
    const plain404 = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: { message: "Not Found" } }) }));
    const plainDiagnostics: OpenRouterDiagnostic[] = [];
    await extractSignalWithOpenRouter(candidate, { ...options, fetcher: plain404, paidGuard, onDiagnostic: (item) => { plainDiagnostics.push(item); } });
    await mapClaimToClusterWithOpenRouter(claim, clusters, { ...options, fetcher: plain404, paidGuard, onDiagnostic: (item) => { plainDiagnostics.push(item); } });
    const plainHttpFailures = plainDiagnostics.filter((item) => item.code === "request_http_failure");
    expect(plainHttpFailures.length).toBeGreaterThan(0);
    expect(plainHttpFailures.every((item) => !("routingRefusal" in item))).toBe(true);
    const throwingReporter = () => { throw new Error("PRIVATE sink failure"); };
    expect(await extractSignalWithOpenRouter(candidate, { ...options, fetcher, onDiagnostic: throwingReporter })).toEqual(withoutExtraction);
    expect(await mapClaimToClusterWithOpenRouter(claim, clusters, { ...options, fetcher, onDiagnostic: throwingReporter })).toEqual(withoutMapping);
  });
});

describe("routing refusal sentence", () => {
  it.each([
    ["No allowed providers are available for the selected model.", "No allowed providers are available for the selected model."],
    ["No endpoints found matching your data policy (Zero data retention). Configure: https://openrouter.ai/settings/privacy",
      "No endpoints found matching your data policy (Zero data retention)."],
    ["No endpoints found that can handle the requested price. PRIVATE key, prompt, headers, body",
      "No endpoints found that can handle the requested price."],
    ["No endpoints found <script>", undefined],
    ["Not found", undefined],
  ])("keeps only the first plain routing sentence of %s", async (message, kept) => {
    const { openRouterRoutingRefusalDetails } = await import("@/lib/automation/budget");
    const details = openRouterRoutingRefusalDetails(404, { error: { message } });
    expect(details.routingMessage).toBe(kept);
    const [stored] = appendOpenRouterDiagnostics(undefined, [{ code: "request_http_failure", elapsedMs: 5, httpStatus: 404, attempts: 1,
      routingRefusal: "unknown", routingMessage: message } as OpenRouterDiagnostic]);
    expect(stored.routingMessage).toBe(kept);
    expect(JSON.stringify(stored)).not.toContain("PRIVATE");
  });

  it("drops the sentence from records that are not routing refusals", () => {
    const [stored] = appendOpenRouterDiagnostics(undefined, [{ code: "request_http_failure", elapsedMs: 5, httpStatus: 502, attempts: 1,
      routingMessage: "No endpoints found." } as OpenRouterDiagnostic]);
    expect(stored).not.toHaveProperty("routingMessage");
  });

  it("shows the sentence in the scanner evidence readout", () => {
    const evidence = scannerAiEvidence({ openRouterDiagnostics: [{ code: "request_http_failure", elapsedMs: 5, httpStatus: 404, attempts: 1,
      routingRefusal: "unknown", routingMessage: "No allowed providers are available for the selected model." }] }, 1, ["openrouter_no_route"])!;
    expect(scannerAiEvidenceLines(parseScannerAiEvidence(evidence)!).join("\n"))
      .toContain('OpenRouter said: "No allowed providers are available for the selected model."');
  });
});
