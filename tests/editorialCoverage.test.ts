import { describe, expect, it } from "vitest";
import { getEditorialCoverage, reviewedCoverage } from "@/lib/editorialCoverage";

describe("reviewed newspaper coverage", () => {
  it("publishes the verified selections with credit and source dates after a newer patch", () => {
    const items = getEditorialCoverage(new Date("2026-09-05T23:00:00Z"));
    expect(items).toHaveLength(reviewedCoverage.length);
    expect(items.map((item) => item.sourceId)).toContain("khraze-gaming");
    expect(items.find((item) => item.sourceId === "pc-gamer")?.publishedAt).toBe("2026-09-03");
    expect(items.every((item) => item.topic === "expansion" && item.sourceTitle && item.excerpt)).toBe(true);
    expect(new Set(items.map((item) => item.url)).size).toBe(items.length);
    for (const item of items) {
      expect(item).not.toHaveProperty("snippet");
      expect(item).not.toHaveProperty("creatorChannelId");
    }
  });

  it("does not announce a source before its publication date", () => {
    expect(getEditorialCoverage(new Date("2026-09-02T23:59:59Z"))).toEqual([]);
    const items = getEditorialCoverage(new Date("2026-09-03T15:00:00Z"));
    expect(items.map((item) => item.type)).not.toContain("video");
  });
});
