import { describe, expect, it } from "vitest";
import { evaluateCurrentPatchEligibility, explicitPatchVersions } from "@/lib/automation/eligibility";
import { preScreenCandidate } from "@/lib/automation/relevance";

const CURRENT_PATCH = {
  currentPatchVersion: "1.14.00",
  currentPatchPublishedAt: "2026-07-16T09:00:00.000Z",
};

describe("scanner trust regressions", () => {
  it("rejects an unrelated r/ProtonMail result even though Reddit is reputable", () => {
    expect(preScreenCandidate({
      title: "Any plans for MCP? : r/ProtonMail",
      snippet: "Feature request. Proton was quick to roll out an LLM with Lumo.",
      url: "https://www.reddit.com/r/ProtonMail/comments/example/any_plans_for_mcp/",
      sourceDomain: "reddit.com",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "off_topic" });
  });

  it("rejects an unrelated PUBG complaint instead of trusting the Reddit host", () => {
    expect(preScreenCandidate({
      title: "PUBG crashes after the new update",
      snippet: "The game crashes to desktop every match.",
      url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/example/crashes/",
      sourceDomain: "reddit.com",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "off_topic" });
  });

  it("rejects piracy coverage even when it names Crimson Desert and the current patch", () => {
    expect(preScreenCandidate({
      title: "Crimson Desert 1.14.00 repack",
      snippet: "Clean Steam files and crack download are available.",
      url: "https://example.com/crimson-desert-repack",
      sourceDomain: "example.com",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "source_not_issue_report" });
  });

  it("parses the Version X.Y.ZZ wording that leaked the old 1.03.01 result", () => {
    expect(explicitPatchVersions("[Updates] Patch Notes Version 1.03.01 (All Platforms Hotfix)")).toEqual([
      "1.03.01",
    ]);
    expect(preScreenCandidate({
      title: "[Updates] Patch Notes Version 1.03.01 (All Platforms Hotfix)",
      snippet: "Crimson Desert patch notes from an older release.",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/example/patch_notes_10301/",
      sourceDomain: "reddit.com",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "wrong_patch" });
  });

  it("does not mistake an unrelated feature version for a game patch", () => {
    const title = "Crimson Desert crashes with DLSS version 4.0";

    expect(explicitPatchVersions(title)).toEqual([]);
    expect(evaluateCurrentPatchEligibility({
      title,
      sourcePublishedAt: "2026-07-22T12:00:00.000Z",
    }, {
      version: CURRENT_PATCH.currentPatchVersion,
      publishedAt: CURRENT_PATCH.currentPatchPublishedAt,
    })).toEqual({ canStore: true, canPublish: true, reason: "fresh_source" });
  });

  it("does not mistake a graphics-driver update version for a game patch", () => {
    const title = "Crimson Desert crashes after NVIDIA update version 576.80";

    expect(explicitPatchVersions(title)).toEqual([]);
    expect(evaluateCurrentPatchEligibility({
      title,
      sourcePublishedAt: "2026-07-22T12:00:00.000Z",
    }, {
      version: CURRENT_PATCH.currentPatchVersion,
      publishedAt: CURRENT_PATCH.currentPatchPublishedAt,
    })).toEqual({ canStore: true, canPublish: true, reason: "fresh_source" });
  });
});
