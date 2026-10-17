import { describe, expect, it } from "vitest";
import { evaluateCurrentPatchEligibility, extractSourcePatchVersions, storedSourceFreshnessInput } from "@/lib/automation/eligibility";
import { preScreenCandidate } from "@/lib/automation/relevance";
import { isPostCurrentPatchEvidence } from "@/lib/patchWatch";

const patch = { version: "2.03.02", publishedAt: "2026-10-01T12:00:00Z" };
const row = {
  title: "Crimson Desert frame drops",
  summary: "Recent patches, including 2.03.02, still have frame drops.",
  source_published_at: "2026-09-01T12:00:00Z",
};

describe("stored source freshness", () => {
  it("preserves source references independently of summary phrasing and raw-text retention", () => {
    const versions = extractSourcePatchVersions("The game stutters since patch 2.03.02.");
    const input = storedSourceFreshnessInput({ ...row, extracted_facts: { sourcePatchVersions: versions } });
    expect(evaluateCurrentPatchEligibility(input, patch).reason).toBe("current_patch");
    expect(isPostCurrentPatchEvidence(input, patch)).toBe(true);
    expect(input.sourcePublishedAt).toBe(row.source_published_at);
    expect(evaluateCurrentPatchEligibility(input, { ...patch, version: "2.04.00" }).reason).toBe("wrong_patch");
  });

  it.each([[], null, "2.03.02", ["patch 2.03.02"], ["2.03.02", 3]].map((versions) => ({ versions })))(
    "does not use an AI-invented patch when stored proof is empty or malformed: $versions",
    ({ versions }) => {
      const input = storedSourceFreshnessInput({
        ...row, summary: "Frame drops since patch 2.03.02.",
        extracted_facts: { sourcePatchVersions: versions },
      });
      expect(evaluateCurrentPatchEligibility(input, patch).reason).toBe("stale_source");
      expect(isPostCurrentPatchEvidence(input, patch)).toBe(false);
      expect(evaluateCurrentPatchEligibility({ ...input, sourcePublishedAt: null }, patch).canPublish).toBe(false);
    },
  );

  it("keeps source dates usable without explicit patch references", () => {
    const input = storedSourceFreshnessInput({
      ...row, source_published_at: "2026-10-02T12:00:00Z", extracted_facts: { sourcePatchVersions: [] },
    });
    expect(evaluateCurrentPatchEligibility(input, patch).reason).toBe("fresh_source");
  });

  it("retains legacy behavior when a row predates source proof", () => {
    const input = storedSourceFreshnessInput({ ...row, summary: "Stutters after patch 2.03.02.", extracted_facts: { platform: "ps5" } });
    expect(evaluateCurrentPatchEligibility(input, patch).reason).toBe("current_patch");
    expect(evaluateCurrentPatchEligibility(storedSourceFreshnessInput(row), patch).reason).toBe("stale_source");
  });

  it("keeps exact-patch evidence distinct from patch-family eligibility", () => {
    const versions = extractSourcePatchVersions("After patch 1.13.00 the frame rate fell.");
    const input = storedSourceFreshnessInput({ ...row, extracted_facts: { sourcePatchVersions: versions } });
    expect(versions).toEqual(["1.13.00"]);
    const original = { ...patch, version: "1.13.00" };
    const hotfix = { ...patch, version: "1.13.01" };
    expect(isPostCurrentPatchEvidence(input, original)).toBe(true);
    expect(isPostCurrentPatchEvidence(input, hotfix)).toBe(false);
    expect(evaluateCurrentPatchEligibility(input, hotfix).canPublish).toBe(true);
  });
});

describe("activity after the patch", () => {
  const thread = {
    title: "Crimson Desert crashes when I open the inventory",
    snippet: "The game crashes to desktop every time I open the inventory.",
    sourcePublishedAt: "2026-09-20T12:00:00Z",
  };

  it("keeps an older thread with a reply after the patch as a lead, never as publishable evidence", () => {
    const result = evaluateCurrentPatchEligibility({ ...thread, sourceActiveAt: "2026-10-05T08:00:00Z" }, patch);
    expect(result).toEqual({ canStore: true, canPublish: false, reason: "active_after_patch" });
    expect(isPostCurrentPatchEvidence({ ...thread, sourceActiveAt: "2026-10-05T08:00:00Z" }, patch)).toBe(false);
  });

  it.each([
    ["the last reply came before the patch", "2026-09-30T12:00:00Z"],
    ["the last reply is earlier than the opening post", "2026-09-19T12:00:00Z"],
    ["the activity time cannot be read", "not a date"],
    ["there is no activity time", null],
  ])("stays stale when %s", (_label, sourceActiveAt) => {
    expect(evaluateCurrentPatchEligibility({ ...thread, sourceActiveAt }, patch).reason).toBe("stale_source");
  });

  it("lets an explicit older patch in the text win over recent activity", () => {
    const result = evaluateCurrentPatchEligibility(
      { ...thread, snippet: "Crashes since patch 2.01.00 when opening the inventory.", sourceActiveAt: "2026-10-05T08:00:00Z" },
      patch,
    );
    expect(result.reason).toBe("wrong_patch");
  });

  it("reads a stored activity time and ignores a malformed one", () => {
    const stored = (sourceActiveAt: unknown) => storedSourceFreshnessInput({
      title: thread.title, summary: "Inventory crash.", source_published_at: thread.sourcePublishedAt,
      extracted_facts: { sourcePatchVersions: [], sourceActiveAt },
    });
    expect(stored("2026-10-05T08:00:00Z").sourceActiveAt).toBe("2026-10-05T08:00:00Z");
    expect(evaluateCurrentPatchEligibility(stored("2026-10-05T08:00:00Z"), patch).reason).toBe("active_after_patch");
    for (const bad of [12345, "yesterday", null, undefined]) {
      expect(stored(bad).sourceActiveAt).toBeNull();
      expect(evaluateCurrentPatchEligibility(stored(bad), patch).reason).toBe("stale_source");
    }
  });

  it("lets the pre-screen keep an active older forum thread that describes a problem", () => {
    const options = { currentPatchVersion: patch.version, currentPatchPublishedAt: patch.publishedAt };
    const input = {
      ...thread,
      url: "https://steamcommunity.com/app/3321460/discussions/0/1/",
      sourceDomain: "steamcommunity.com",
    };
    expect(preScreenCandidate(input, options)).toEqual({ keep: false, reason: "stale_source" });
    expect(preScreenCandidate({ ...input, sourceActiveAt: "2026-10-05T08:00:00Z" }, options)).toEqual({ keep: true });
  });
});
