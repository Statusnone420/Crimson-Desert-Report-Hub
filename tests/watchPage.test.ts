import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));
vi.mock("@/components/dispatch/Chrome", () => ({
  PublicShell: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

import WatchPage from "@/app/watch/page";
import { getEditorialCoverage } from "@/lib/editorialCoverage";
import { getWatchSelections, officialWatchSelection } from "@/lib/watchSelections";

const stillManifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/watch/sources.json"), "utf8"),
) as {
  assets: { file: string; videoUrl: string; sha256: string; bytes: number; width: number; height: number }[];
};

function renderWatch() {
  return renderToStaticMarkup(createElement(WatchPage));
}

describe("watch desk selections", () => {
  afterEach(() => vi.useRealTimers());

  it("always leads with the official reveal and keeps playback on YouTube", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:10:00.000Z"));
    const selections = getWatchSelections();
    expect(selections).toEqual([officialWatchSelection]);
    expect(selections[0]?.url).toBe("https://www.youtube.com/watch?v=HaCtG1F_hfE");
    const markup = renderWatch();
    expect(markup).toContain("Pearl Abyss’s Charting the Unknown reveal trailer.");
    expect(markup).toContain("Watch the official reveal ↗");
    expect(markup).toContain("HaCtG1F_hfE.jpg");
    expect(markup).toContain("Pearl Abyss");
    expect(markup).toContain("Official");
    expect(markup).not.toContain("KhrazeGaming");
    expect(markup).not.toContain("youtube.com/embed");
    expect(markup).not.toContain("iframe");
    expect(markup).not.toContain("autoplay");
    expect(markup).not.toContain("UCFXUSG_393wZJaRTErU6Pjw");
  });

  it("adds the reviewed creator selection after its source date, without inventing counts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T23:00:00.000Z"));
    const selections = getWatchSelections();
    expect(selections.map((item) => item.url)).toEqual([
      "https://www.youtube.com/watch?v=HaCtG1F_hfE",
      "https://www.youtube.com/watch?v=6H6c0S80d4U",
    ]);
    const creator = selections[1];
    expect(creator).toMatchObject({
      kind: "creator",
      sourceLabel: "KhrazeGaming",
      kindLabel: "Creator commentary",
      headline: "KhrazeGaming breaks down the expansion reveal",
      reason: "KhrazeGaming’s video covers the first Crimson Desert expansion details, including ship navigation and new islands.",
      publishedAt: "2026-09-03T18:35:11Z",
    });
    const markup = renderWatch();
    expect(markup).toContain("The official Charting the Unknown reveal, then one creator’s reading of it.");
    expect(markup).toContain("Watch on YouTube ↗");
    expect(markup).toContain("6H6c0S80d4U.jpg");
    expect(markup).toContain("Sep 3, 2026");
    expect(markup).not.toContain("451196");
    expect(markup).not.toContain("58012");
    expect(markup).not.toContain("views");
    expect(getEditorialCoverage().some((item) => item.url === officialWatchSelection.url)).toBe(false);
  });

  it("keeps hosted stills aligned with the verified YouTube maxres files", () => {
    expect(stillManifest.assets.map((asset) => asset.videoUrl)).toEqual([
      "https://www.youtube.com/watch?v=HaCtG1F_hfE",
      "https://www.youtube.com/watch?v=6H6c0S80d4U",
    ]);
    for (const asset of stillManifest.assets) {
      const bytes = readFileSync(path.join(process.cwd(), "public", asset.file.replace(/^\//, "")));
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
      expect(asset.width).toBe(1280);
      expect(asset.height).toBe(720);
    }
  });
});
