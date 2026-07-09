import { describe, expect, it } from "vitest";
import {
  belongsToPatchFamily,
  isPostCurrentPatchEvidence,
  patchFamilyKey,
  playerIssueStatus,
  publicPatchWatchItem,
} from "@/lib/patchWatch";

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

describe("playerIssueStatus", () => {
  it("warns when there is only one approved direct report", () => {
    expect(
      playerIssueStatus({
        directReportCount: 1,
        publicSignalCount: 0,
        candidateSignalCount: 0,
        postCurrentPatchEvidenceCount: 0,
        fixStatus: "reported",
      }),
    ).toMatchObject({
      label: "Player reported",
      strengthLabel: "1 player report, 0 public sources",
    });
  });

  it("labels public-source-only evidence without pretending players confirmed it", () => {
    expect(
      playerIssueStatus({
        directReportCount: 0,
        publicSignalCount: 1,
        candidateSignalCount: 0,
        postCurrentPatchEvidenceCount: 0,
        fixStatus: "reported",
      }),
    ).toMatchObject({
      label: "Needs confirmation",
      strengthLabel: "0 player reports, 1 public source",
    });
  });

  it("keeps private candidates as confirmation work, not public proof", () => {
    expect(
      playerIssueStatus({
        directReportCount: 0,
        publicSignalCount: 0,
        candidateSignalCount: 3,
        postCurrentPatchEvidenceCount: 0,
        fixStatus: "reported",
      }),
    ).toMatchObject({
      label: "Needs confirmation",
      strengthLabel: "3 private mentions, no public proof",
    });
  });

  it("marks a claimed fix as watching without post-hotfix evidence", () => {
    expect(
      playerIssueStatus({
        directReportCount: 1,
        publicSignalCount: 0,
        candidateSignalCount: 0,
        postCurrentPatchEvidenceCount: 0,
        fixStatus: "fix_claimed",
      }),
    ).toMatchObject({
      label: "Watching fix",
      strengthLabel: "1 player report, 0 public sources",
    });
  });

  it("marks a claimed fix as still happening only with post-hotfix evidence", () => {
    expect(
      playerIssueStatus({
        directReportCount: 1,
        publicSignalCount: 0,
        candidateSignalCount: 0,
        postCurrentPatchEvidenceCount: 1,
        fixStatus: "fix_claimed",
      }),
    ).toMatchObject({
      label: "Still happening",
      strengthLabel: "1 player report, 0 public sources",
    });
  });

  it("labels verified fixed as no fresh reports", () => {
    expect(
      playerIssueStatus({
        directReportCount: 1,
        publicSignalCount: 0,
        candidateSignalCount: 0,
        postCurrentPatchEvidenceCount: 0,
        fixStatus: "verified_fixed",
      }),
    ).toMatchObject({
      label: "No fresh reports",
      strengthLabel: "1 player report, 0 public sources",
    });
  });
});

describe("publicPatchWatchItem", () => {
  it("exposes only public counts and labels for private candidate-only topics", () => {
    const item = publicPatchWatchItem({
      title: "Mount controls broken",
      description: "Watchlist item for mount/input issues.",
      directReportCount: 0,
      publicSignalCount: 0,
      candidateSignalCount: 2,
      postCurrentPatchEvidenceCount: 0,
      fixStatus: "reported",
    });

    expect(item).toEqual({
      title: "Mount controls broken",
      description: "Watchlist item for mount/input issues.",
      label: "Needs confirmation",
      strengthLabel: "2 private mentions, no public proof",
      detail: "The scanner found private candidates, but they need a player report or publishable source.",
      tone: "amber",
    });
    expect(JSON.stringify(item)).not.toContain("source_url");
    expect(JSON.stringify(item)).not.toContain("reject");
  });
});
