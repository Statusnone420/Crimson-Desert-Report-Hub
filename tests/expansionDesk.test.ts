import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CatchUpMilestone } from "@/lib/catchUpContent";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Omit<ComponentProps<"a">, "href"> & { href: string; children?: ReactNode }) =>
    createElement("a", { ...props, href }, children),
}));

import { ExpansionDesk } from "@/components/newspaper/ExpansionDesk";
import { OFFICIAL_REVEAL_URL } from "@/lib/watchSelections";

const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const desk = (now: string, milestones?: readonly CatchUpMilestone[]) => renderToStaticMarkup(createElement(ExpansionDesk, { now: Date.parse(now), milestones }));

const base = {
  kind: "announcement" as const,
  summary: "A summary.",
  highlights: ["A highlight."] as const,
};
const fixtures: CatchUpMilestone[] = [
  {
    ...base, id: "delay", publishedAt: "2026-09-30T10:20:00Z", title: "The date moves",
    release: { id: "charting-the-unknown", at: "2026-10-29T22:00:00Z" },
    noticeSays: ["The release moves to October 29."],
    source: { label: "Pearl Abyss · delay notice", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=134" },
  },
  {
    ...base, id: "short", publishedAt: "2026-10-08T09:00:00Z", title: "A short", about: "charting-the-unknown",
    noticeSays: ["A short shows diving."],
    source: { label: "Diving short", url: "https://www.youtube.com/shorts/er6wiBEXYYs" },
  },
  {
    ...base, id: "moved-again", publishedAt: "2026-10-25T10:00:00Z", title: "The date moves again",
    release: { id: "charting-the-unknown", at: "2026-11-05T22:00:00Z" },
    noticeSays: ["The release moves to November 5.", "Castles open after the main story."],
    source: { label: "Pearl Abyss · second delay", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=200" },
    related: [{ label: "New trailer", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }],
  },
  {
    ...base, id: "unrelated", publishedAt: "2026-10-26T10:00:00Z", title: "Another game's news",
    noticeSays: ["Not about the expansion."],
    source: { label: "Elsewhere", url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=201" },
  },
];

describe("the expansion desk", () => {
  it("takes its date, lines and videos from the notices the Hub had at the time", () => {
    const markup = desk("2026-10-26T12:00:00Z", fixtures);
    const page = text(markup);
    expect(page).toContain("Lands in 10 days, Nov 5, 22:00 UTC.");
    expect(page.indexOf("The release moves to November 5.")).toBeLessThan(page.indexOf("A short shows diving."));
    expect(page.indexOf("A short shows diving.")).toBeLessThan(page.indexOf("The release moves to October 29."));
    expect(page).toContain("Castles open after the main story.");
    expect(page).not.toContain("Not about the expansion.");
    expect(markup).toContain('href="https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=200"');
    const videos = [...markup.matchAll(/<a class="video-link" href="([^"]+)"/g)].map((match) => match[1]);
    expect(videos).toEqual(["https://www.youtube.com/watch?v=AAAAAAAAAAA", "https://www.youtube.com/shorts/er6wiBEXYYs", OFFICIAL_REVEAL_URL]);
  });

  it("leaves out a notice published after the moment it shows", () => {
    const page = text(desk("2026-10-21T12:00:00Z", fixtures));
    expect(page).toContain("Lands in 8 days, Oct 29, 22:00 UTC.");
    expect(page).not.toContain("The release moves to November 5.");
  });

  it("renders today's stored timeline: the Oct 20 unlocks, what is not said, and the official videos", () => {
    const markup = desk("2026-10-21T12:00:00Z");
    const page = text(markup);
    expect(page).toContain("Lands in 8 days, Oct 29, 22:00 UTC.");
    expect(page).toContain("Diving needs no special conditions.");
    expect(page).toContain("The upgraded housing system opens after setting up camp at Howling Hill");
    expect(page).toContain("Not said yet");
    expect(page).toContain("A price. Each store lists its own.");
    expect(page).toContain("The download size.");
    expect(page).toContain("A Mac date.");
    expect(markup).toContain('href="https://www.youtube.com/watch?v=k9WnZqkAFis"');
    expect(markup).toContain(`href="${OFFICIAL_REVEAL_URL}"`);
  });

  it("says the expansion is out once the release time passes", () => {
    expect(text(desk("2026-11-10T00:00:00Z"))).toContain("Out since Oct 29, 22:00 UTC.");
    expect(text(desk("2026-10-30T00:00:00Z"))).toContain("Launch week on the front page");
  });

  it("says no date is announced when no notice sets one yet", () => {
    const page = text(desk("2026-09-01T00:00:00Z"));
    expect(page).toContain("No release date announced yet.");
    expect(page).not.toContain("Not said yet");
  });
});
