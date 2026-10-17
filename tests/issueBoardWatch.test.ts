import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/ConfirmButtons", () => ({ ConfirmButtons: () => createElement("div", null, "confirm") }));

import { IssueBoard } from "@/components/newspaper/IssueBoard";

const watching = {
  patchVersion: "2.03.02",
  threads: 51,
  topics: 27,
  systems: [{ category: "crash_startup" as const, threads: 25 }, { category: "quest_progression" as const, threads: 10 }, { category: "graphics_visual" as const, threads: 9 }, { category: "audio" as const, threads: 1 }],
};

describe("issue board empty state", () => {
  it("adds what the scanner is watching, as counts only, when nothing is published", () => {
    const html = renderToStaticMarkup(createElement(IssueBoard, { published: [], watchlist: [], emptyPatchVersion: "2.03.02", watching }));
    expect(html).toContain("No published issues yet for 2.03.02.");
    expect(html).toContain("The scanner is watching 27 topics from 51 Steam forum threads first seen on 2.03.02.");
    expect(html).toContain("The most threads: crashes and startup 25, quests and progression 10, graphics and visual 9.");
    expect(html).toContain("These are leads, not confirmed reports.");
    expect(html).not.toContain("audio 1");
  });

  it("keeps the plain message when the counts are unavailable or zero", () => {
    for (const value of [null, { ...watching, threads: 0, topics: 0, systems: [] }]) {
      const html = renderToStaticMarkup(createElement(IssueBoard, { published: [], watchlist: [], emptyPatchVersion: "2.03.02", watching: value }));
      expect(html).toContain("No published issues yet for 2.03.02.");
      expect(html).not.toContain("The scanner is watching");
    }
  });
});
