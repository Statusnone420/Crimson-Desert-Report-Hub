import "server-only";

import { canonicalizeUrl } from "@/lib/automation/dedupe";
import { extractSignalWithOpenRouter, type ExtractionResult } from "@/lib/automation/extract";
import {
  preScreenCandidate,
  shouldKeepExtractedSignal,
  type SignalRelevanceDecision,
} from "@/lib/automation/relevance";
import { buildSearchQueries, tavilySearch } from "@/lib/automation/search";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";

const SEARCH_QUERY_COST_USD = 0.008;
const MAX_PREVIEW_QUERIES = 2;
const MAX_PREVIEW_RESULTS = 5;

export type AutomationSourcePreview = {
  mode: "preview";
  patchVersion: string;
  maxQueries: number;
  queriesUsed: number;
  resultsSeen: number;
  estimatedCostUsd: number;
  previews: {
    query: string;
    title: string;
    url: string;
    sourceDomain: string | null;
    extraction: ExtractionResult;
    relevance: SignalRelevanceDecision;
  }[];
};

function boundedQueryCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(MAX_PREVIEW_QUERIES, Math.trunc(value)));
}

export async function previewAutomationSearch(input: { maxQueries: number }): Promise<AutomationSourcePreview> {
  const maxQueries = boundedQueryCount(input.maxQueries);
  const previews: AutomationSourcePreview["previews"] = [];
  let queriesUsed = 0;
  let resultsSeen = 0;
  const currentPatch = await getCurrentPatchMetadata();

  for (const query of buildSearchQueries(maxQueries, currentPatch.version)) {
    queriesUsed += 1;
    const results = await tavilySearch(query);
    resultsSeen += results.length;

    for (const result of results) {
      let url: string;
      try {
        url = canonicalizeUrl(result.url);
      } catch {
        continue;
      }

      const preScreen = preScreenCandidate(
        { title: result.title, snippet: result.snippet, sourceDomain: result.sourceDomain },
        { currentPatchVersion: currentPatch.version },
      );

      const extraction = await extractSignalWithOpenRouter(
        { title: result.title, snippet: result.snippet, url },
        { llmCallsRemaining: preScreen.keep ? 1 : 0 },
      );

      const relevance: SignalRelevanceDecision = preScreen.keep ? shouldKeepExtractedSignal(extraction) : preScreen;

      previews.push({
        query,
        title: result.title,
        url,
        sourceDomain: result.sourceDomain,
        extraction,
        relevance,
      });

      if (previews.length >= MAX_PREVIEW_RESULTS) break;
    }

    if (previews.length >= MAX_PREVIEW_RESULTS) break;
  }

  return {
    mode: "preview",
    patchVersion: currentPatch.version,
    maxQueries,
    queriesUsed,
    resultsSeen,
    estimatedCostUsd: queriesUsed * SEARCH_QUERY_COST_USD,
    previews,
  };
}
