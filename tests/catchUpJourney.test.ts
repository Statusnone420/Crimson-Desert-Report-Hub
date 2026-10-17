import { describe, expect, it } from "vitest";
import { chapterProgressExtent, containedScrollDeltaFromRects } from "@/lib/catchUpJourney";

describe("catch-up journey rail geometry", () => {
  it("does not move a container when the active chapter is already visible", () => {
    expect(containedScrollDeltaFromRects({ top: 100, height: 400 }, { top: 180, height: 68 })).toBe(0);
  });

  it("scrolls only far enough to reveal a chapter above or below the rail", () => {
    expect(containedScrollDeltaFromRects({ top: 100, height: 400 }, { top: 40, height: 68 })).toBe(-60);
    expect(containedScrollDeltaFromRects({ top: 100, height: 400 }, { top: 480, height: 68 })).toBe(48);
  });

  it("keeps a taller chapter aligned to the top of the rail", () => {
    expect(containedScrollDeltaFromRects({ top: 0, height: 80 }, { top: 20, height: 200 })).toBe(20);
  });

  it("honors padding without using page scroll", () => {
    expect(containedScrollDeltaFromRects({ top: 100, height: 400 }, { top: 104, height: 68 }, 8)).toBe(-4);
    expect(containedScrollDeltaFromRects({ top: 100, height: 400 }, { top: 428, height: 68 }, 8)).toBe(4);
  });

  it("sizes the red fill from the top of the list to the active chapter", () => {
    expect(chapterProgressExtent(null)).toBe(0);
    expect(chapterProgressExtent({ offsetTop: 0, offsetHeight: 68 })).toBe(68);
    expect(chapterProgressExtent({ offsetTop: 612, offsetHeight: 68 })).toBe(680);
    expect(chapterProgressExtent({ offsetTop: 1147, offsetHeight: 68 })).toBe(1215);
  });
});
