import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  version: "2.00.00",
  cache: new Map<string, unknown>(),
  connection: vi.fn(async () => undefined),
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
vi.mock("@/app/report/ReportForm", () => ({ ReportForm: ({ currentPatch }: { currentPatch: { version: string } }) => createElement("p", null, currentPatch.version) }));

import { getCurrentPatchMetadata, getReportPatchContext } from "@/lib/officialPatch.server";
import ReportPage from "@/app/report/page";

describe("report patch consistency", () => {
  beforeEach(() => { state.version = "2.00.00"; state.cache.clear(); state.connection.mockClear(); });

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
});
