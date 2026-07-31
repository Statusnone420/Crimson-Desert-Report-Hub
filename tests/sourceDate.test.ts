import { describe, expect, it } from "vitest";
import {
  classifyProviderSourceDate,
  resolveAssertedSourceDate,
  resolveSourceDate,
} from "@/lib/automation/sourceDate";

const PATCH = { version: "1.13.01", publishedAt: "2026-07-08T05:51:00.000Z" };
const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function input(overrides: Partial<Parameters<typeof resolveSourceDate>[0]> = {}) {
  return {
    title: "Crimson Desert stutter after the patch",
    sourceText: "Players report constant stutter in towns.",
    canonicalUrl: "https://www.reddit.com/r/CrimsonDesert/comments/abc/stutter",
    sourcePublishedAt: null,
    ...overrides,
  };
}

describe("resolveSourceDate precedence", () => {
  it("takes a direct provider date first and marks it as such", () => {
    expect(
      resolveSourceDate(input({ sourcePublishedAt: "Fri, 17 Jul 2026 00:00:00 GMT" }), PATCH, NOW),
    ).toEqual({ value: "Fri, 17 Jul 2026 00:00:00 GMT", provenance: "provider" });
  });

  it.each([
    [null, "absent"],
    ["Fri, 17 Jul 2026 00:00:00 GMT", "valid"],
    ["yesterday afternoon", "invalid"],
    ["2026-07-25T00:00:00.000Z", "invalid"],
  ] as const)("classifies provider date %s as %s", (sourcePublishedAt, status) => {
    expect(classifyProviderSourceDate({ sourcePublishedAt }, NOW)).toBe(status);
  });

  it("resolves the anchored Reddit posted-on marker", () => {
    expect(
      resolveSourceDate(
        input({ sourceText: "Posted by u/desertrider on 2026-07-14T09:12:00Z — my horse keeps locking up." }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: "2026-07-14T09:12:00Z", provenance: "reddit_posted_iso" });
  });

  describe("Reddit byline provenance comes from the URL, not the text", () => {
    const BYLINE = "Posted by u/desertrider on 2026-07-14T09:12:00Z — my horse keeps locking up.";
    const resolvedAt = (canonicalUrl: string) =>
      resolveSourceDate(input({ sourceText: BYLINE, canonicalUrl }), PATCH, NOW);

    it.each([
      "https://reddit.com/r/CrimsonDesert/comments/abc/stutter",
      "https://www.reddit.com/r/CrimsonDesert/comments/abc/stutter",
      "https://old.reddit.com/r/CrimsonDesert/comments/abc/stutter",
      "https://new.reddit.com/r/CrimsonDesert/comments/abc/stutter",
    ])("accepts the byline on %s", (canonicalUrl) => {
      expect(resolvedAt(canonicalUrl)).toEqual({
        value: "2026-07-14T09:12:00Z",
        provenance: "reddit_posted_iso",
      });
    });

    it.each([
      ["a non-Reddit host", "https://steamcommunity.com/app/3321460/discussions/0/abc/"],
      ["a lookalike host", "https://evilreddit.com/r/CrimsonDesert/comments/abc/stutter"],
      ["a suffix-spoofing host", "https://reddit.com.evil.example/r/CrimsonDesert/comments/abc/stutter"],
      ["a malformed URL", "not a url at all"],
    ])("refuses the same byline text on %s", (_label, canonicalUrl) => {
      expect(resolvedAt(canonicalUrl)).toEqual({ value: null, provenance: null });
    });
  });

  it("resolves a patch-note title that names this patch and one explicit calendar day", () => {
    expect(
      resolveSourceDate(
        input({ title: "Crimson Desert Update 1.13.01 Patch Notes — July 14, 2026" }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: "2026-07-14T00:00:00.000Z", provenance: "anchored_patch_title" });
  });

  it("falls back to the date already stored for the exact same canonical URL", () => {
    expect(
      resolveSourceDate(
        input({
          storedDatesByCanonicalUrl: new Map([
            ["https://www.reddit.com/r/CrimsonDesert/comments/abc/stutter", "2026-07-11T00:00:00.000Z"],
          ]),
        }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: "2026-07-11T00:00:00.000Z", provenance: "exact_canonical_url" });
  });

  it("prefers the provider date over the stored one when both exist", () => {
    expect(
      resolveSourceDate(
        input({
          sourcePublishedAt: "2026-07-16T00:00:00.000Z",
          storedDatesByCanonicalUrl: new Map([
            ["https://www.reddit.com/r/CrimsonDesert/comments/abc/stutter", "2026-07-11T00:00:00.000Z"],
          ]),
        }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: "2026-07-16T00:00:00.000Z", provenance: "provider" });
  });
});

describe("resolveSourceDate refusals", () => {
  it("never reads an arbitrary date out of prose", () => {
    expect(
      resolveSourceDate(
        input({
          sourceText: "Apr 4 @ 1:45am someone replied; see also the July 14, 2026 thread linked below.",
        }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: null, provenance: null });
  });

  it("does not accept a bare date in a non-patch-note title", () => {
    expect(
      resolveSourceDate(input({ title: "Crimson Desert impressions — July 14, 2026" }), PATCH, NOW),
    ).toEqual({ value: null, provenance: null });
  });

  it("does not accept a patch-note title naming a DIFFERENT patch", () => {
    expect(
      resolveSourceDate(
        input({ title: "Crimson Desert Update 1.09.00 Patch Notes — July 14, 2026" }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: null, provenance: null });
  });

  it("does not accept a patch-note title carrying two candidate days", () => {
    expect(
      resolveSourceDate(
        input({ title: "Crimson Desert 1.13.01 Patch Notes — July 14, 2026 (rolled out July 15, 2026)" }),
        PATCH,
        NOW,
      ),
    ).toEqual({ value: null, provenance: null });
  });

  it("does not accept a patch-note title whose date has no explicit year", () => {
    expect(
      resolveSourceDate(input({ title: "Crimson Desert 1.13.01 Patch Notes — July 14" }), PATCH, NOW),
    ).toEqual({ value: null, provenance: null });
  });

  it.each([
    ["malformed", "yesterday afternoon"],
    ["a rolled-over calendar day", "2026-02-30T00:00:00Z"],
    ["an out-of-range timezone offset", "2026-07-14T00:00:00+18:00"],
    ["a trailing zone suffix PostgreSQL rejects", "2026-07-14 00:00:00 GMT-0500"],
  ])("rejects %s provider date", (_label, value) => {
    expect(resolveSourceDate(input({ sourcePublishedAt: value }), PATCH, NOW).value).toBeNull();
    expect(resolveAssertedSourceDate(input({ sourcePublishedAt: value }), PATCH, NOW).value).toBeNull();
  });

  it("rejects a date more than 48 hours in the future", () => {
    expect(
      resolveSourceDate(input({ sourcePublishedAt: "2026-07-25T00:00:00.000Z" }), PATCH, NOW).value,
    ).toBeNull();
    expect(
      resolveAssertedSourceDate(input({ sourcePublishedAt: "2026-07-25T00:00:00.000Z" }), PATCH, NOW).value,
    ).toBeNull();
  });

  it("rejects a pre-era date for display, while freshness screening still sees it", () => {
    const preEra = input({ sourcePublishedAt: "2026-06-30T00:00:00.000Z" });
    expect(resolveSourceDate(preEra, PATCH, NOW).value).toBeNull();
    // The eligibility gate is what decides "stale", so it must still receive the
    // date rather than an ambiguous null.
    expect(resolveAssertedSourceDate(preEra, PATCH, NOW)).toEqual({
      value: "2026-06-30T00:00:00.000Z",
      provenance: "provider",
    });
  });

  it("fails closed when the current patch publication time is unavailable", () => {
    const dated = input({ sourcePublishedAt: "2026-07-14T00:00:00.000Z" });
    expect(resolveSourceDate(dated, { version: "1.13.01", publishedAt: null }, NOW).value).toBeNull();
    expect(
      resolveSourceDate(dated, { version: "1.13.01", publishedAt: "not a date" }, NOW).value,
    ).toBeNull();
  });

  it("never lets one URL's stored date travel to another URL", () => {
    const stored = new Map([
      ["https://www.reddit.com/r/CrimsonDesert/comments/other/thread", "2026-07-11T00:00:00.000Z"],
    ]);
    expect(resolveSourceDate(input({ storedDatesByCanonicalUrl: stored }), PATCH, NOW)).toEqual({
      value: null,
      provenance: null,
    });
  });

  it("never turns scanner time into a publication date", () => {
    // Nothing in the input names a date; observedAt/created_at/last_seen_at are
    // not inputs to this function at all, and the answer is null, not "now".
    expect(resolveSourceDate(input(), PATCH, NOW)).toEqual({ value: null, provenance: null });
    expect(resolveAssertedSourceDate(input(), PATCH, NOW)).toEqual({ value: null, provenance: null });
  });

  it("ignores a loose ISO timestamp that is not the Reddit byline shape", () => {
    expect(
      resolveSourceDate(
        input({ sourceText: "Edited 2026-07-14T09:12:00Z by a moderator." }),
        PATCH,
        NOW,
      ).value,
    ).toBeNull();
  });
});
