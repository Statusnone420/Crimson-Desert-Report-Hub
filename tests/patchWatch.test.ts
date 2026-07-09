import { describe, expect, it } from "vitest";
import { belongsToPatchFamily, isPostCurrentPatchEvidence, patchFamilyKey } from "@/lib/patchWatch";

const currentPatch = { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" };

describe("patch family helpers", () => {
  it("groups hotfix versions into the same patch family", () => {
    expect(patchFamilyKey("1.13.00")).toBe("1.13");
    expect(patchFamilyKey("1.13.01")).toBe("1.13");
    expect(belongsToPatchFamily("1.13.00", "1.13.01")).toBe(true);
    expect(belongsToPatchFamily("1.12.00", "1.13.01")).toBe(false);
  });

  it("does not treat carried-over 1.13.00 evidence as post-hotfix persistence", () => {
    expect(
      isPostCurrentPatchEvidence(
        {
          title: "Awful performance after patch 1.13.00",
          summary: "Players report frame-rate drops since 1.13.00.",
          sourcePublishedAt: "2026-07-07T12:00:00.000Z",
        },
        currentPatch,
      ),
    ).toBe(false);
  });

  it("does not let a post-hotfix timestamp override an explicit older patch mention", () => {
    expect(
      isPostCurrentPatchEvidence(
        {
          title: "Awful performance after patch 1.13.00",
          summary: "The old patch discussion is still circulating.",
          sourcePublishedAt: "2026-07-08T12:00:00.000Z",
        },
        currentPatch,
      ),
    ).toBe(false);
  });

  it("treats post-1.13.01 sources as post-hotfix evidence", () => {
    expect(
      isPostCurrentPatchEvidence(
        {
          title: "FPS still drops after the 1.13.01 hotfix",
          summary: "The frame-rate drop still happens after patch 1.13.01.",
          sourcePublishedAt: "2026-07-08T06:15:00.000Z",
        },
        currentPatch,
      ),
    ).toBe(true);
  });

  it("treats hotfix-prefixed current-version sources as post-hotfix evidence without a source date", () => {
    expect(
      isPostCurrentPatchEvidence(
        {
          title: "FPS still drops after Hotfix 1.13.01",
          summary: "The frame-rate drop still happens.",
          sourcePublishedAt: null,
        },
        currentPatch,
      ),
    ).toBe(true);
  });
});

