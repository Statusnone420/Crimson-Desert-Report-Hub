import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  version: "2.00.00",
  cache: new Map<string, unknown>(),
  connection: vi.fn(async () => undefined),
  issueData: { boardReadFailed: false, clusters: [] as Record<string, unknown>[] },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: state.connection }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: string[]) => Promise<unknown>, key: string[]) => async (...args: string[]) => {
    const id = JSON.stringify([key, args]);
    if (!state.cache.has(id)) state.cache.set(id, await fn(...args));
    return state.cache.get(id);
  },
}));
vi.mock("@/lib/supabase", () => ({
  hasSupabaseServiceConfig: () => true,
  createServiceClient: () => ({
    from: () => {
      let current = true;
      const query = {
        select: () => query,
        eq: (_column: string, value: boolean) => { current = value; return query; },
        order: () => query,
        limit: async () => ({ data: current ? [{ board_no: "100", patch_version: state.version, title: "Official patch", official_url: "https://example.com/patch", published_at: "2026-09-04T12:00:00Z", observed_at: "2026-09-05T12:00:00Z", is_current: true }] : [], error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/components/dispatch/Chrome", () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/lib/queries", () => ({ getIssuesData: async () => state.issueData }));
vi.mock("@/app/report/ReportForm", () => ({
  ReportForm: ({ currentPatch, issueContext }: { currentPatch: { version: string }; issueContext?: { title: string; category: string } | null }) =>
    createElement("p", null, [currentPatch.version, issueContext?.title, issueContext?.category].filter(Boolean).join(" | ")),
}));

import { getCurrentPatchMetadata, getReportPatchContext } from "@/lib/officialPatch.server";
import ReportPage from "@/app/report/page";

describe("report patch consistency", () => {
  beforeEach(() => {
    state.version = "2.00.00";
    state.cache.clear();
    state.connection.mockClear();
    state.issueData = { boardReadFailed: false, clusters: [] };
  });

  it("uses the canonical current-patch cache rather than taking an independent snapshot", async () => {
    const mastheadPatch = await getCurrentPatchMetadata();
    state.version = "2.01.00";
    expect((await getReportPatchContext()).currentPatch).toEqual(mastheadPatch);
    state.cache.clear(); // Simulates current-patch tag invalidation.
    expect((await getReportPatchContext()).currentPatch.version).toBe("2.01.00");
    expect((await getCurrentPatchMetadata()).version).toBe("2.01.00");
  });

  it("waits for a request before rendering the report page and its dateline", async () => {
    const markup = renderToStaticMarkup(await ReportPage());
    expect(state.connection).toHaveBeenCalledOnce();
    expect(markup).toContain("2.00.00");
  });

  it("passes only a renderable public issue selected by UUID", async () => {
    const issueId = "123e4567-e89b-42d3-a456-426614174000";
    state.issueData = {
      boardReadFailed: false,
      clusters: [{
        id: issueId,
        title: "Map freezes during combat",
        category: "controls_gameplay",
        strengthScore: 0,
        directReportCount: 0,
        confirmations: { totalCount: 0 },
        readout: { poll: null },
        candidateSignalCount: 1,
      }],
    };
    const markup = renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ issue: issueId }) }));
    expect(markup).toContain("Map freezes during combat | controls_gameplay");
  });

  it("does not disclose monitored-only, unsupported-category, or malformed issue context", async () => {
    const issueId = "123e4567-e89b-42d3-a456-426614174000";
    state.issueData = {
      boardReadFailed: false,
      clusters: [{
        id: issueId,
        title: "Withheld monitored title",
        category: "other",
        strengthScore: 0,
        directReportCount: 0,
        confirmations: { totalCount: 0 },
        readout: { poll: null },
        candidateSignalCount: 0,
      }],
    };
    const monitored = renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ issue: issueId }) }));
    state.issueData.clusters[0]!.candidateSignalCount = 1;
    state.issueData.clusters[0]!.category = "private_internal_category";
    const unsupportedCategory = renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ issue: issueId }) }));
    const malformed = renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ issue: "not-a-uuid" }) }));
    expect(monitored).not.toContain("Withheld monitored title");
    expect(unsupportedCategory).not.toContain("Withheld monitored title");
    expect(malformed).not.toContain("Withheld monitored title");
  });
});
