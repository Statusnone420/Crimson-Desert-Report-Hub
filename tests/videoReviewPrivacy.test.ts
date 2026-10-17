import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WatchPage from "@/app/watch/page";
import { getWatchSelections } from "@/lib/watchSelections";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  readOwnerAttentionBrief: vi.fn(),
}));

vi.mock("@/lib/adminGuard", () => ({ isAdmin: mocks.isAdmin }));
vi.mock("@/lib/ownerAttentionBrief", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownerAttentionBrief")>("@/lib/ownerAttentionBrief");
  return { ...actual, readOwnerAttentionBrief: mocks.readOwnerAttentionBrief };
});
vi.mock("@/lib/supabase", () => ({
  createServiceClient: vi.fn(),
  hasSupabaseServiceConfig: () => true,
}));

describe("video inbox privacy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T23:00:00.000Z"));
    mocks.isAdmin.mockReset();
    mocks.readOwnerAttentionBrief.mockReset();
  });

  it("leaves public Watch output on the two approved videos", () => {
    const selections = getWatchSelections();
    expect(selections.map((item) => item.url)).toEqual([
      "https://www.youtube.com/watch?v=HaCtG1F_hfE",
      "https://www.youtube.com/watch?v=6H6c0S80d4U",
    ]);
    const markup = renderToStaticMarkup(createElement(WatchPage));
    expect(markup).not.toContain("zzInboxMock");
    expect(markup).not.toContain("Invented review note");
    expect(markup).not.toContain("/admin/videos");
    expect(markup).not.toContain("FixtureChannel");
  });

  it("keeps inbox writes off public cache revalidation", () => {
    const actions = readFileSync("src/app/admin/videos/actions.ts", "utf8");
    expect(actions).toContain('revalidatePath("/admin/videos")');
    expect(actions).not.toContain("revalidatePublicSurfaces");
  });

  it("rejects unauthenticated brief and draft downloads without reading the inbox", async () => {
    mocks.isAdmin.mockResolvedValue(false);
    const { GET: briefGet } = await import("@/app/api/admin/video-review-brief/route");
    const { GET: draftGet } = await import("@/app/api/admin/videos/[id]/draft/route");
    const brief = await briefGet();
    const draft = await draftGet(new Request("http://127.0.0.1/api/admin/videos/video-1/draft"), {
      params: Promise.resolve({ id: "video-1" }),
    });
    expect(brief.status).toBe(401);
    expect(draft.status).toBe(401);
    expect(brief.headers.get("cache-control")).toMatch(/no-store/);
    expect(brief.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(mocks.readOwnerAttentionBrief).not.toHaveBeenCalled();
  });
});
