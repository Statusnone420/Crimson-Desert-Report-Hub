import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS } from "@/lib/constants";
import { assignIssueArt, ISSUE_ART, type IssueArt } from "@/lib/issueArt";

const officialManifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/official/sources.json"), "utf8"),
) as {
  assets: { file: string; source: string; sha256: string; bytes: number; width: number; height: number; context: string }[];
};

describe("ISSUE_ART", () => {
  const images = Object.values(ISSUE_ART).flat();

  it("gives every category its own three images", () => {
    expect(Object.keys(ISSUE_ART).sort()).toEqual(Object.keys(CATEGORY_LABELS).sort());
    for (const set of Object.values(ISSUE_ART)) expect(set).toHaveLength(3);
    expect(new Set(images.map((image) => image.src)).size).toBe(images.length);
  });

  it("uses only recorded official screenshots, at their real size", () => {
    for (const image of images) {
      const record = officialManifest.assets.find((asset) => asset.file === image.src);
      expect(record, image.src).toBeDefined();
      expect(record!.source).toMatch(/^https:\/\/s1\.pearlcdn\.com\/cd\/brand\/media_GLOBAL\//);
      expect(record!.context).toContain("not evidence of a specific fix");
      expect([record!.width, record!.height]).toEqual([image.width, image.height]);
      const file = readFileSync(path.join(process.cwd(), "public", image.src));
      expect(file.byteLength, image.src).toBe(record!.bytes);
      expect(createHash("sha256").update(file).digest("hex"), image.src).toBe(record!.sha256);
    }
  });
});

const image = (name: string): IssueArt => ({ src: `/official/${name}.jpg`, width: 1600, height: 900, position: "center" });
const pools = {
  crash_startup: [image("crash-a"), image("crash-b"), image("crash-c")],
  performance: [image("performance-a"), image("performance-b")],
  other: [image("other-a")],
};
const topic = (id: string, category: string) => ({ id, category });

describe("assignIssueArt", () => {
  it("gives a topic the same image on every visit, whatever order the board lists topics in", () => {
    const topics = [topic("a1", "crash_startup"), topic("b2", "crash_startup"), topic("c3", "performance")];
    const first = assignIssueArt(topics, pools);
    const reversed = assignIssueArt([...topics].reverse(), pools);
    for (const { id } of topics) expect(reversed.get(id)).toBe(first.get(id));
  });

  it("never gives two topics in one category the same image while the category has room", () => {
    const topics = ["one", "two", "three"].map((id) => topic(id, "crash_startup"));
    const assigned = assignIssueArt(topics, pools);
    const images = topics.map(({ id }) => assigned.get(id));
    expect(new Set(images).size).toBe(3);
    for (const picked of images) expect(pools.crash_startup).toContain(picked);
  });

  it("borrows unused images from other categories before repeating one in a column", () => {
    const topics = ["p1", "p2", "p3", "p4"].map((id) => topic(id, "performance"));
    const assigned = assignIssueArt(topics, pools);
    const images = topics.map(({ id }) => assigned.get(id)!);
    expect(new Set(images).size).toBe(4);
    expect(images.filter((picked) => pools.performance.includes(picked))).toHaveLength(2);
  });

  it("repeats only once every image is in use, and still gives every topic one", () => {
    const topics = Array.from({ length: 8 }, (_, index) => topic(`t${index}`, "other"));
    const assigned = assignIssueArt(topics, pools);
    expect(assigned.size).toBe(8);
    expect(new Set(assigned.values()).size).toBe(6);
  });

  it("uses the other set for a category it does not know", () => {
    expect(assignIssueArt([topic("x", "new_category")], pools).get("x")).toBe(pools.other[0]);
  });
});
