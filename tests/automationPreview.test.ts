import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractSignalWithOpenRouter: vi.fn(),
  getCurrentPatchMetadata: vi.fn(),
  tavilySearch: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/automation/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/search")>();
  return {
    ...actual,
    tavilySearch: mocks.tavilySearch,
  };
});

vi.mock("@/lib/automation/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/automation/extract")>();
  return {
    ...actual,
    extractSignalWithOpenRouter: mocks.extractSignalWithOpenRouter,
  };
});

vi.mock("@/lib/officialPatch.server", () => ({
  getCurrentPatchMetadata: mocks.getCurrentPatchMetadata,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentPatchMetadata.mockResolvedValue({
    version: "1.13.00",
    title: "Patch Notes Version 1.13.00",
    officialUrl: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
    publishedAt: "2026-07-03T03:00:00.000Z",
    summary: "Official test patch metadata.",
    source: "official",
  });
  mocks.tavilySearch.mockResolvedValue([
    {
      title: "Crimson Desert patch 1.13 FPS regression",
      url: "https://example.com/fps?utm_source=reddit",
      snippet: "Players report FPS drops on Steam.",
      sourceDomain: "example.com",
      observedAt: "2026-07-05T12:00:00.000Z",
    },
  ]);
  mocks.extractSignalWithOpenRouter.mockResolvedValue({
    issueTitle: "FPS regression since 1.13",
    category: "performance",
    platform: "pc_steam",
    confidence: "medium",
    summary: "Players report FPS drops on Steam after patch 1.13.",
    extractionProvider: "deterministic",
    extractionModel: null,
    llmCallsUsed: 0,
    llmCostUsd: 0,
  });
});

describe("previewAutomationSearch", () => {
  it("runs a capped no-write source preview and canonicalizes URLs", async () => {
    const { previewAutomationSearch } = await import("@/lib/automation/preview");

    const result = await previewAutomationSearch({ maxQueries: 1 });

    expect(result).toMatchObject({
      mode: "preview",
      maxQueries: 1,
      queriesUsed: 1,
      resultsSeen: 1,
      estimatedCostUsd: 0.008,
      previews: [
        {
          query: "site:reddit.com r/CrimsonDesert Crimson Desert patch 1.13.00 crash stutter performance bug",
          title: "Crimson Desert patch 1.13 FPS regression",
          url: "https://example.com/fps",
          sourceDomain: "example.com",
          extraction: {
            issueTitle: "FPS regression since 1.13",
            category: "performance",
            platform: "pc_steam",
            extractionProvider: "deterministic",
          },
          relevance: { keep: true },
        },
      ],
    });
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        snippet: "Players report FPS drops on Steam.",
        url: "https://example.com/fps",
      },
      { llmCallsRemaining: 0 },
    );
  });

  it("never previews more than two search queries from one request", async () => {
    const { previewAutomationSearch } = await import("@/lib/automation/preview");

    const result = await previewAutomationSearch({ maxQueries: 10 });

    expect(result.maxQueries).toBe(2);
    expect(mocks.tavilySearch).toHaveBeenCalledTimes(2);
  });

  it("marks broad patch notes as skipped in the no-write preview without an LLM call", async () => {
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
        url: "https://example.com/patch-notes",
        snippet: "Official update notes and balance changes.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    const { previewAutomationSearch } = await import("@/lib/automation/preview");

    const result = await previewAutomationSearch({ maxQueries: 1 });

    expect(result.previews[0]).toMatchObject({
      title: "Crimson Desert Patch 1.13.00 Full Patch Notes",
      relevance: { keep: false, reason: "source_not_issue_report" },
    });
    expect(mocks.extractSignalWithOpenRouter).toHaveBeenCalledWith(
      expect.anything(),
      { llmCallsRemaining: 0 },
    );
  });

  it("uses URL context when pre-screening unknown-domain preview results", async () => {
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Players report a regression",
        url: "https://example.net/crimson-desert-fps-drops?utm_source=search",
        snippet: "FPS drops after patch 1.13.00.",
        sourceDomain: "example.net",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    const { previewAutomationSearch } = await import("@/lib/automation/preview");

    const result = await previewAutomationSearch({ maxQueries: 1 });

    expect(result.previews[0]).toMatchObject({
      url: "https://example.net/crimson-desert-fps-drops",
      relevance: { keep: true },
    });
  });

  it("keeps every eligible preview result on deterministic extraction", async () => {
    mocks.tavilySearch.mockResolvedValue([
      {
        title: "Crimson Desert patch 1.13 FPS regression",
        url: "https://example.com/fps",
        snippet: "Players report FPS drops on Steam.",
        sourceDomain: "example.com",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
      {
        title: "Crimson Desert patch 1.13 FPS drops during combat",
        url: "https://example.net/stutter",
        snippet: "Players report FPS drops and stutter after patch 1.13.00.",
        sourceDomain: "example.net",
        observedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
    let providerAttempts = 0;
    mocks.extractSignalWithOpenRouter.mockImplementation(async (candidate, options) => {
      if (options.llmCallsRemaining > 0) providerAttempts += 1;
      return {
        issueTitle: candidate.title,
        category: "performance",
        platform: "pc_steam",
        confidence: "medium",
        summary: candidate.snippet,
        extractionProvider: "deterministic",
        extractionModel: null,
        llmCallsUsed: options.llmCallsRemaining > 0 ? 1 : 0,
        llmCostUsd: 0,
      };
    });
    const { previewAutomationSearch } = await import("@/lib/automation/preview");

    const result = await previewAutomationSearch({ maxQueries: 1 });

    expect(result.previews).toHaveLength(2);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[0][1].llmCallsRemaining).toBe(0);
    expect(mocks.extractSignalWithOpenRouter.mock.calls[1][1].llmCallsRemaining).toBe(0);
    expect(providerAttempts).toBe(0);
  });
});
