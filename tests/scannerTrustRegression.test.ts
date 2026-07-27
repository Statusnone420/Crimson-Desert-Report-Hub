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

  it("rejects an unrelated subreddit even when its search snippet quotes Crimson Desert", () => {
    expect(preScreenCandidate({
      title: "guerilla warfare mortars off the roof : r/PUBATTLEGROUNDS",
      snippet: "[Request] Pearl Abyss, please add one of these bad boys to equip on the trading wagons r/CrimsonDesert.",
      url: "https://www.reddit.com/r/PUBATTLEGROUNDS/comments/example/guerilla_warfare_mortars/",
      sourceDomain: "reddit.com",
      sourcePublishedAt: "2026-07-21T12:00:00.000Z",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "off_topic" });
  });

  it("keeps an explicitly named Crimson Desert report posted to a general subreddit", () => {
    expect(preScreenCandidate({
      title: "Crimson Desert crashes every time I open the map",
      snippet: "The game crashes to desktop after the current patch.",
      url: "https://www.reddit.com/r/pcgaming/comments/example/crimson_desert_map_crash/",
      sourceDomain: "reddit.com",
      sourcePublishedAt: "2026-07-21T12:00:00.000Z",
    }, CURRENT_PATCH)).toEqual({ keep: true });
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

  it("routes an official known-issues page to the observation lane, never to evidence", () => {
    // The publisher's evergreen Known Issues page carries the same symptom nouns
    // as a player complaint and its title matches no patch-release pattern, so
    // before the official-domain route it reached keep: true and pearlabyss.com
    // could corroborate a cluster as "player evidence".
    expect(preScreenCandidate({
      title: "Crimson Desert – Known Issues",
      snippet: "Quest cannot progress after the cutscene in some regions. The game crashes when riding a bear.",
      url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=105",
      sourceDomain: "crimsondesert.pearlabyss.com",
      sourcePublishedAt: "2026-07-21T12:00:00.000Z",
    }, CURRENT_PATCH)).toEqual({ keep: false, reason: "source_not_issue_report", observationKind: "patch_release" });
  });

  it("still keeps the identical complaint text from a non-official domain", () => {
    expect(preScreenCandidate({
      title: "Crimson Desert – Known Issues megathread",
      snippet: "Quest cannot progress after the cutscene in some regions. The game crashes when riding a bear.",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/example/known_issues_megathread/",
      sourceDomain: "reddit.com",
      sourcePublishedAt: "2026-07-21T12:00:00.000Z",
    }, CURRENT_PATCH)).toEqual({ keep: true });
  });
});
