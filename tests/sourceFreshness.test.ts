import { describe, expect, it } from "vitest";
import { evaluateCurrentPatchEligibility, extractSourcePatchVersions, storedSourceFreshnessInput } from "@/lib/automation/eligibility";
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
