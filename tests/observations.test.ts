import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendUniqueObservation,
  MAX_OBSERVATIONS_PER_RUN,
  normalizeAskSeriesTitle,
  observationConflictHash,
  observationUrlHash,
  persistObservations,
  shouldCollectObservation,
  upgradeObservationDate,
  type ObservationCandidate,
} from "@/lib/automation/observations";
import { preScreenCandidate } from "@/lib/automation/relevance";

const PATCH_OPTIONS = { currentPatchVersion: "1.13.01", currentPatchPublishedAt: "2026-07-08T00:00:00.000Z" };

function candidate(overrides: Partial<ObservationCandidate> = {}): ObservationCandidate {
  return {
    kind: "press_reception",
    title: "Crimson Desert 1.13.01 tested",
    url: "https://www.dsogaming.com/articles/cd-11301-tested/",
    sourceDomain: "dsogaming.com",
    snippet: "Frame pacing improved in our benchmark run.",
    sourcePublishedAt: null,
    observedAt: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

describe("pre-screen observation genres", () => {
  it("tags a patch release announcement as patch_release", () => {
    const decision = preScreenCandidate(
      {
        title: "Crimson Desert patch 1.13.01 released with full notes",
        snippet: "Pearl Abyss detailed the update for all platforms.",
        sourceDomain: "pcgamer.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false, observationKind: "patch_release" });
  });

  it("tags press coverage (review/benchmark) as press_reception", () => {
    const decision = preScreenCandidate(
      {
        title: "Crimson Desert 1.13.01 performance test on PS5 Pro",
        snippet: "We measured the patch across three areas.",
        sourceDomain: "dsogaming.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false, observationKind: "press_reception" });
  });

  it("tags patch-notes mirrors as patch_release, not press", () => {
    const decision = preScreenCandidate(
      {
        title: "Patch Notes Version 1.13.01 - Crimson Desert",
        snippet: "Fixed an issue where the game would occasionally crash when riding a bear.",
        sourceDomain: "patchbot.io",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false, observationKind: "patch_release" });
  });

  it("tags fix announcements as fix_announcement", () => {
    const decision = preScreenCandidate(
      {
        title: "Crimson Desert hotfix news",
        snippet: "The 1.13.01 update brings performance fixes and smoother performance on consoles.",
        sourceDomain: "wccftech.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false, observationKind: "fix_announcement" });
  });

  it("gives guides and trailers no genre", () => {
    const decision = preScreenCandidate(
      {
        title: "Crimson Desert walkthrough for the wyvern quest",
        snippet: "Step by step quest guide.",
        sourceDomain: "ign.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false });
    expect((decision as { observationKind?: string }).observationKind).toBeUndefined();
  });

  it("never tags wrong-patch or piracy-context rejects", () => {
    const wrongPatch = preScreenCandidate(
      {
        title: "Crimson Desert patch 1.12.00 released and detailed",
        snippet: "Old update notes for 1.12.00 only.",
        sourceDomain: "pcgamer.com",
      },
      PATCH_OPTIONS,
    );
    expect(wrongPatch).toMatchObject({ keep: false, reason: "wrong_patch" });
    expect((wrongPatch as { observationKind?: string }).observationKind).toBeUndefined();

    const piracy = preScreenCandidate(
      {
        title: "Crimson Desert patch 1.13.01 released - crackwatch",
        snippet: "Repacks available.",
        sourceDomain: "example.com",
      },
      PATCH_OPTIONS,
    );
    expect(piracy).toMatchObject({ keep: false, reason: "source_not_issue_report" });
    expect((piracy as { observationKind?: string }).observationKind).toBeUndefined();
  });

  it("keeps real complaints out of the observation lane entirely", () => {
    const decision = preScreenCandidate(
      {
        title: "FPS drops since patch 1.13.01",
        snippet: "Constant stuttering in open-field combat after the update.",
        sourceDomain: "reddit.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toEqual({ keep: true });
  });
});

describe("shouldCollectObservation", () => {
  it("collects trusted-domain candidates with a genre", () => {
    expect(
      shouldCollectObservation({
        title: "Crimson Desert benchmark",
        snippet: "Crimson Desert performance coverage.",
        url: "https://www.dsogaming.com/articles/crimson-desert-benchmark/",
        sourceDomain: "dsogaming.com",
        observationKind: "press_reception",
      }, 0),
    ).toBe(true);
  });

  it("rejects untrusted domains even with a genre", () => {
    expect(
      shouldCollectObservation({
        title: "Crimson Desert patch released",
        snippet: "Crimson Desert patch coverage.",
        url: "https://instagram.com/example",
        sourceDomain: "instagram.com",
        observationKind: "patch_release",
      }, 0),
    ).toBe(false);
    expect(shouldCollectObservation({
      title: "Crimson Desert patch released",
      snippet: "Crimson Desert patch coverage.",
      url: "https://example.invalid/patch",
      sourceDomain: null,
      observationKind: "patch_release",
    }, 0)).toBe(false);
  });

  it("rejects candidates without a genre", () => {
    expect(shouldCollectObservation({
      title: "Crimson Desert benchmark",
      snippet: "Crimson Desert performance coverage.",
      url: "https://www.dsogaming.com/articles/crimson-desert-benchmark/",
      sourceDomain: "dsogaming.com",
    }, 0)).toBe(false);
  });

  it("does not turn trusted-host reputation into topic relevance", () => {
    expect(shouldCollectObservation({
      title: "Any plans for MCP?",
      snippet: "A Proton feature request about Lumo.",
      url: "https://www.reddit.com/r/ProtonMail/comments/example/any_plans_for_mcp/",
      sourceDomain: "reddit.com",
      observationKind: "community_ask",
    }, 0)).toBe(false);
  });

  it("enforces the per-run cap", () => {
    expect(
      shouldCollectObservation(
        {
          title: "Crimson Desert benchmark",
          snippet: "Crimson Desert performance coverage.",
          url: "https://www.dsogaming.com/articles/crimson-desert-benchmark/",
          sourceDomain: "dsogaming.com",
          observationKind: "press_reception",
        },
        MAX_OBSERVATIONS_PER_RUN,
      ),
    ).toBe(false);
  });
});

describe("appendUniqueObservation", () => {
  it("deduplicates campaign fingerprints before applying the per-run cap", () => {
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    const day20 = candidate({
      kind: "community_ask",
      title: "Day 20 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/aaa/day_20/",
      sourceDomain: "reddit.com",
    });
    const day21 = candidate({
      kind: "community_ask",
      title: "Day 21 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/",
      sourceDomain: "reddit.com",
    });

    expect(appendUniqueObservation(observations, day20, seenConflictHashes)).toBe(true);
    expect(appendUniqueObservation(observations, day21, seenConflictHashes)).toBe(false);
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN - 1; index += 1) {
      expect(
        appendUniqueObservation(
          observations,
          candidate({ url: `https://www.dsogaming.com/articles/coverage-${index}/` }),
          seenConflictHashes,
        ),
      ).toBe(true);
    }

    expect(observations).toHaveLength(MAX_OBSERVATIONS_PER_RUN);
    expect(
      appendUniqueObservation(
        observations,
        candidate({ url: "https://www.dsogaming.com/articles/coverage-overflow/" }),
        seenConflictHashes,
      ),
    ).toBe(false);
  });

  it("displaces the newest undated row when a dated candidate meets a full shelf", () => {
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    const dated = candidate({
      url: "https://www.polygon.com/crimson-desert-patch-fixes/",
      sourceDomain: "polygon.com",
      sourcePublishedAt: "2026-07-16T09:00:00.000Z",
    });
    expect(appendUniqueObservation(observations, dated, seenConflictHashes)).toBe(true);

    // Cap holds, the dated row is in, and the row that gave up its slot is the
    // NEWEST undated one — earlier rows keep first-wins seniority.
    expect(observations).toHaveLength(MAX_OBSERVATIONS_PER_RUN);
    expect(observations.map((row) => row.url)).toEqual([
      "https://www.dsogaming.com/articles/undated-0/",
      "https://www.dsogaming.com/articles/undated-1/",
      "https://www.dsogaming.com/articles/undated-2/",
      "https://www.dsogaming.com/articles/undated-3/",
      "https://www.polygon.com/crimson-desert-patch-fixes/",
    ]);

    // A second dated candidate takes the next-newest undated row's PLACE.
    // In place matters: persistence inserts in array order under the per-patch
    // cap, and appending would hand the dated row the first ordinal dropped.
    const alsoDated = candidate({
      url: "https://www.pushsquare.com/news/crimson-desert-patch-fixes",
      sourceDomain: "pushsquare.com",
      sourcePublishedAt: "2026-07-16T10:00:00.000Z",
    });
    expect(appendUniqueObservation(observations, alsoDated, seenConflictHashes)).toBe(true);
    expect(observations.map((row) => row.url)).toEqual([
      "https://www.dsogaming.com/articles/undated-0/",
      "https://www.dsogaming.com/articles/undated-1/",
      "https://www.dsogaming.com/articles/undated-2/",
      "https://www.pushsquare.com/news/crimson-desert-patch-fixes",
      "https://www.polygon.com/crimson-desert-patch-fixes/",
    ]);

    // The displaced page was considered this run: it cannot re-enter.
    expect(
      appendUniqueObservation(
        observations,
        candidate({ url: "https://www.dsogaming.com/articles/undated-4/" }),
        seenConflictHashes,
      ),
    ).toBe(false);
  });

  it("never displaces a dated row, even for another dated candidate", () => {
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({
          url: `https://www.dsogaming.com/articles/dated-${index}/`,
          sourcePublishedAt: "2026-07-16T09:00:00.000Z",
        }),
        seenConflictHashes,
      );
    }

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-late-dated/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-16T10:00:00.000Z",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);
  });

  it("does not let an unparseable date displace anything", () => {
    // The persistence RPC stores a malformed external timestamp as NULL, so a
    // truthy-but-unparseable date would spend the swap on a row exactly as
    // unrenderable as the one it took.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-malformed-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "yesterday-ish",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);
  });

  it("rejects a calendar-invalid ISO date that JavaScript would roll over", () => {
    // Date.parse accepts 2026-02-30 as March 2; the persistence RPC rejects it
    // and stores NULL. A rolled-over date must not buy a swap.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-rollover-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-02-30T00:00:00.000Z",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);

    // A real calendar date with a timezone offset is NOT collateral damage,
    // even when its UTC day differs from the literal one.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-offset-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-16T23:30:00-05:00",
        }),
        seenConflictHashes,
      ),
    ).toBe(true);
    expect(observations.map((row) => row.url)).toContain("https://www.polygon.com/crimson-desert-offset-date/");
  });

  it("grants the wire's real RFC 1123 dates displacement priority", () => {
    // Ground truth (probed live 2026-07-27): Tavily's news index emits
    // `Fri, 24 Jul 2026 00:00:00 GMT`, not ISO. If that shape does not count
    // as dated, the entire displacement feature never fires in production.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-wire-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "Thu, 16 Jul 2026 09:00:00 GMT",
        }),
        seenConflictHashes,
      ),
    ).toBe(true);
    expect(observations.map((row) => row.url)).toContain("https://www.polygon.com/crimson-desert-wire-date/");

    // The RFC branch validates calendar components the same way the ISO
    // branch does: PostgreSQL rejects Feb 30 in any format.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-rfc-rollover/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "Mon, 30 Feb 2026 00:00:00 GMT",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);

    // And it anchors the whole string: `GMT-0500` parses in JavaScript but
    // PostgreSQL rejects the zone, so it must not buy a swap.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-js-only-zone/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "Thu, 16 Jul 2026 00:00:00 GMT-0500",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);

    // Edge whitespace PostgreSQL forgives is forgiven here too: a padded wire
    // date must not silently switch displacement off.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-padded-wire-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "Thu, 16 Jul 2026 01:00:00 GMT ",
        }),
        seenConflictHashes,
      ),
    ).toBe(true);
    expect(observations.map((row) => row.url)).toContain(
      "https://www.polygon.com/crimson-desert-padded-wire-date/",
    );

    // Padded ISO too: the composite trims once up front, so the strict ISO
    // parser and the display gate judge the identical string.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-padded-iso-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-16T02:00:00.000Z ",
        }),
        seenConflictHashes,
      ),
    ).toBe(true);
    expect(observations.map((row) => row.url)).toContain(
      "https://www.polygon.com/crimson-desert-padded-iso-date/",
    );
  });

  it("allowlists date formats instead of trusting JavaScript's parser", () => {
    // Every case here is a string Date.parse happily accepts. All but the
    // last die at the RPC's ::timestamptz cast (rolled-over slash date;
    // timezone displacement past PostgreSQL's ±15:59 limit; a JS-only zone
    // suffix riding a space-separated ISO date through the lenient legacy
    // parser; non-breaking spaces, which PostgreSQL's datetime scanner
    // rejects and String.prototype.trim would have hidden) and must not buy
    // a swap. The last would survive the cast, but it is no format the
    // pipeline's sources emit, so it conservatively loses priority — never
    // a slot.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    for (const sourcePublishedAt of [
      "02/30/2026",
      "2026-07-16T00:00:00+16:00",
      "2026-07-16 00:00:00 GMT-0500",
      "Thu,\u00A016\u00A0Jul\u00A02026\u00A000:00:00\u00A0GMT",
      "July 16, 2026",
    ]) {
      expect(
        appendUniqueObservation(
          observations,
          candidate({
            url: `https://www.polygon.com/crimson-desert-impostor/${encodeURIComponent(sourcePublishedAt)}/`,
            sourceDomain: "polygon.com",
            sourcePublishedAt,
          }),
          seenConflictHashes,
        ),
      ).toBe(false);
    }
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);
  });

  it("denies priority to a date the Brief could never show, in both directions", () => {
    // A timestamp far in the future survives the ::timestamptz cast, but the
    // display gate rejects anything more than 48 hours past the clock — so it
    // must neither buy a swap nor sit on the shelf masquerading as dated.
    // Judged at the run's observedAt (2026-07-16T12:00Z here): the Brief
    // re-checks with a strictly later clock, so clearing skew at collection
    // can never flip to failing it at render.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    // Direction one: the future-dated candidate evicts nothing.
    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.polygon.com/crimson-desert-future-date/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-19T00:00:00.000Z",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);

    // Direction two: a future-dated incumbent does not block a real dated
    // candidate — it reads as undated to the shelf scan and gives up its slot.
    const futureShelf: ObservationCandidate[] = [];
    const futureHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        futureShelf,
        candidate({
          url: `https://www.dsogaming.com/articles/future-${index}/`,
          sourcePublishedAt: "2026-07-19T00:00:00.000Z",
        }),
        futureHashes,
      );
    }
    expect(
      appendUniqueObservation(
        futureShelf,
        candidate({
          url: "https://www.polygon.com/crimson-desert-really-dated/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-16T09:00:00.000Z",
        }),
        futureHashes,
      ),
    ).toBe(true);
    expect(futureShelf.map((row) => row.url)).toContain("https://www.polygon.com/crimson-desert-really-dated/");
  });

  it("applies the patch-era floor to priority when the era is known", () => {
    // The display gate's other date bound: a row published before the patch
    // era never renders in this patch's Brief, no matter how real its date.
    // With the era supplied, it gets no priority; with the era unknown, the
    // check is skipped — exactly like the display gate itself.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
        PATCH_OPTIONS.currentPatchPublishedAt,
      );
    }

    const preEra = {
      url: "https://www.polygon.com/crimson-desert-pre-era/",
      sourceDomain: "polygon.com",
      sourcePublishedAt: "2026-07-01T09:00:00.000Z",
    };
    expect(
      appendUniqueObservation(observations, candidate(preEra), seenConflictHashes, PATCH_OPTIONS.currentPatchPublishedAt),
    ).toBe(false);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);

    // Same candidate, era unknown: the floor cannot apply, so the date counts.
    const unknownEraShelf = observations.map((row) => ({ ...row }));
    const unknownEraHashes = new Set<string>();
    for (const row of unknownEraShelf) unknownEraHashes.add(observationConflictHash(row));
    expect(appendUniqueObservation(unknownEraShelf, candidate(preEra), unknownEraHashes)).toBe(true);
    expect(unknownEraShelf.map((row) => row.url)).toContain("https://www.polygon.com/crimson-desert-pre-era/");
  });

  it("lets a dated duplicate upgrade its undated twin instead of vanishing", () => {
    // General search returns a page undated; the wire returns the SAME page
    // dated, later in the run. The duplicate never gets a second slot, but
    // its date coalesces onto the incumbent — first-wins for content, the
    // run's only dated copy of the page still makes its twin renderable.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    appendUniqueObservation(
      observations,
      candidate({ url: "https://www.dsogaming.com/articles/cd-mirror/" }),
      seenConflictHashes,
    );

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://www.dsogaming.com/articles/cd-mirror/",
          sourcePublishedAt: "Thu, 16 Jul 2026 09:00:00 GMT",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations).toHaveLength(1);
    expect(observations[0].sourcePublishedAt).toBe("Thu, 16 Jul 2026 09:00:00 GMT");

    // A dated incumbent is never overwritten by a later duplicate's date.
    appendUniqueObservation(
      observations,
      candidate({
        url: "https://www.dsogaming.com/articles/cd-mirror/",
        sourcePublishedAt: "Thu, 16 Jul 2026 11:00:00 GMT",
      }),
      seenConflictHashes,
    );
    expect(observations[0].sourcePublishedAt).toBe("Thu, 16 Jul 2026 09:00:00 GMT");

    // A date the Brief could never show is no upgrade at all.
    const undatedShelf: ObservationCandidate[] = [];
    const undatedHashes = new Set<string>();
    appendUniqueObservation(
      undatedShelf,
      candidate({ url: "https://www.dsogaming.com/articles/cd-second-mirror/" }),
      undatedHashes,
    );
    appendUniqueObservation(
      undatedShelf,
      candidate({
        url: "https://www.dsogaming.com/articles/cd-second-mirror/",
        sourcePublishedAt: "2026-07-19T00:00:00.000Z",
      }),
      undatedHashes,
    );
    expect(undatedShelf[0].sourcePublishedAt).toBeNull();
  });

  it("never donates a date across an ask campaign's different threads", () => {
    // "Day 20" and "Day 21" share one campaign fingerprint by design — but
    // they are different pages with different publication dates. Donating
    // Day 21's date to Day 20's row would carry a pre-era thread past the
    // patch-era floor: a date must never describe a page it does not belong
    // to.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    const dayTwenty = candidate({
      kind: "community_ask",
      title: "Day 20 of asking Pearl Abyss for controller remapping in Crimson Desert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/day20/",
      sourceDomain: "reddit.com",
      sourcePublishedAt: "2026-07-01T09:00:00.000Z",
    });
    expect(
      appendUniqueObservation(observations, dayTwenty, seenConflictHashes, PATCH_OPTIONS.currentPatchPublishedAt),
    ).toBe(true);

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          kind: "community_ask",
          title: "Day 21 of asking Pearl Abyss for controller remapping in Crimson Desert",
          url: "https://www.reddit.com/r/CrimsonDesert/comments/day21/",
          sourceDomain: "reddit.com",
          sourcePublishedAt: "2026-07-16T09:00:00.000Z",
        }),
        seenConflictHashes,
        PATCH_OPTIONS.currentPatchPublishedAt,
      ),
    ).toBe(false);
    expect(observations).toHaveLength(1);
    expect(observations[0].url).toBe("https://www.reddit.com/r/CrimsonDesert/comments/day20/");
    expect(observations[0].sourcePublishedAt).toBe("2026-07-01T09:00:00.000Z");
  });

  it("upgrades by canonical URL at the signal-dedup boundary", () => {
    // prepareSignals drops a duplicate signal before the observation reroute
    // sees it, so the date is offered to the shelf at the drop site.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    appendUniqueObservation(
      observations,
      candidate({ url: "https://www.dsogaming.com/articles/cd-mirror/" }),
      seenConflictHashes,
    );

    expect(
      upgradeObservationDate(
        observations,
        "https://www.dsogaming.com/articles/cd-mirror/",
        "Thu, 16 Jul 2026 09:00:00 GMT",
      ),
    ).toBe(true);
    expect(observations[0].sourcePublishedAt).toBe("Thu, 16 Jul 2026 09:00:00 GMT");

    // No matching page, no date, or an already-dated row: all no-ops.
    expect(
      upgradeObservationDate(observations, "https://www.dsogaming.com/articles/unseen/", "Thu, 16 Jul 2026 09:00:00 GMT"),
    ).toBe(false);
    expect(upgradeObservationDate(observations, "https://www.dsogaming.com/articles/cd-mirror/", null)).toBe(false);
    expect(
      upgradeObservationDate(observations, "https://www.dsogaming.com/articles/cd-mirror/", "Thu, 16 Jul 2026 11:00:00 GMT"),
    ).toBe(false);
    expect(observations[0].sourcePublishedAt).toBe("Thu, 16 Jul 2026 09:00:00 GMT");
  });

  it("treats a malformed incumbent date as undated when selecting the displaced row", () => {
    // Five malformed-dated rows can fill the shelf while it has space, and
    // persistence will null every one of those timestamps. A genuinely dated
    // candidate must see through them, or the Brief ends the run with a full
    // shelf and nothing renderable.
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({
          url: `https://www.dsogaming.com/articles/malformed-${index}/`,
          sourcePublishedAt: "yesterday-ish",
        }),
        seenConflictHashes,
      );
    }

    const dated = candidate({
      url: "https://www.polygon.com/crimson-desert-real-date/",
      sourceDomain: "polygon.com",
      sourcePublishedAt: "2026-07-16T09:00:00.000Z",
    });
    expect(appendUniqueObservation(observations, dated, seenConflictHashes)).toBe(true);
    expect(observations.map((row) => row.url)).toContain("https://www.polygon.com/crimson-desert-real-date/");
    expect(observations).toHaveLength(MAX_OBSERVATIONS_PER_RUN);
  });

  it("applies every other gate to a displacing candidate — an untrusted dated page evicts nothing", () => {
    const observations: ObservationCandidate[] = [];
    const seenConflictHashes = new Set<string>();
    for (let index = 0; index < MAX_OBSERVATIONS_PER_RUN; index += 1) {
      appendUniqueObservation(
        observations,
        candidate({ url: `https://www.dsogaming.com/articles/undated-${index}/` }),
        seenConflictHashes,
      );
    }

    expect(
      appendUniqueObservation(
        observations,
        candidate({
          url: "https://randomblog.example/crimson-desert-dated/",
          sourceDomain: "randomblog.example",
          sourcePublishedAt: "2026-07-16T09:00:00.000Z",
        }),
        seenConflictHashes,
      ),
    ).toBe(false);
    expect(observations).toHaveLength(MAX_OBSERVATIONS_PER_RUN);
    expect(observations.every((row) => row.url.includes("dsogaming"))).toBe(true);
  });
});

type RpcCall = { name: string; params: Record<string, unknown> };
type RpcResult = { data: number | null; error: { message: string } | null };

function stubClient({
  rpcCalls = [],
  rpcResult = { data: 1, error: null },
}: { rpcCalls?: RpcCall[]; rpcResult?: RpcResult } = {}) {
  return {
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(rpcResult);
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
}

describe("ask series fingerprinting", () => {
  it("collapses daily campaign posts into one fingerprint", () => {
    const day20 = candidate({
      kind: "community_ask",
      title: "Day 20 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/aaa/day_20/",
      sourceDomain: "reddit.com",
    });
    const day21 = candidate({
      kind: "community_ask",
      title: "Day 21 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/",
      sourceDomain: "reddit.com",
    });
    expect(normalizeAskSeriesTitle(day20.title)).toBe("day # of asking to add caracals to the desert");
    expect(observationConflictHash(day20)).toBe(observationConflictHash(day21));
  });

  it("keeps coverage observations keyed by URL, not title", () => {
    const a = candidate({ url: "https://www.dsogaming.com/a/" });
    const b = candidate({ url: "https://www.dsogaming.com/b/" });
    expect(observationConflictHash(a)).toBe(observationUrlHash(a.url));
    expect(observationConflictHash(a)).not.toBe(observationConflictHash(b));
  });

  it("preserves semantic numbers outside the serialized day number", () => {
    const twoPlayerAsk = candidate({
      kind: "community_ask",
      title: "Day 3 of asking for 2-player co-op : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/aaa/day_3_two_player/",
      sourceDomain: "reddit.com",
    });
    const fourPlayerAsk = candidate({
      kind: "community_ask",
      title: "Day 3 of asking for 4-player co-op : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_3_four_player/",
      sourceDomain: "reddit.com",
    });

    expect(normalizeAskSeriesTitle(twoPlayerAsk.title)).toBe("day # of asking for 2-player co-op");
    expect(normalizeAskSeriesTitle(fourPlayerAsk.title)).toBe("day # of asking for 4-player co-op");
    expect(observationConflictHash(twoPlayerAsk)).not.toBe(observationConflictHash(fourPlayerAsk));
  });
});

describe("persistObservations", () => {
  it("delegates persistence to the atomic RPC and counts inserted rows", async () => {
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient({ rpcCalls }), [candidate()], "1.13.01", report);
    expect(report.errors).toEqual([]);
    expect(report.observationsKept).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("persist_patch_observations");
    expect(rpcCalls[0].params).toMatchObject({ p_patch_version: "1.13.01" });
    expect(rpcCalls[0].params.p_observations).toEqual([
      expect.objectContaining({
        kind: "press_reception",
        source_domain: "dsogaming.com",
        url_hash: observationUrlHash(candidate().url),
      }),
    ]);
  });

  it("orders dated rows ahead of the patch cap's cutoff", async () => {
    // The RPC inserts in array order and stops minting new rows at the patch
    // cap, so ordinal is priority under scarcity: a renderable dated row must
    // never wait at the tail behind rows the Brief can never show. Collection
    // order still breaks ties within each class, and a malformed date counts
    // as undated — persistence will null it.
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ rpcCalls, rpcResult: { data: 4, error: null } }),
      [
        candidate({ url: "https://www.dsogaming.com/articles/undated-first/" }),
        candidate({
          url: "https://www.polygon.com/crimson-desert-dated-late/",
          sourceDomain: "polygon.com",
          sourcePublishedAt: "2026-07-16T09:00:00.000Z",
        }),
        candidate({
          url: "https://www.dsogaming.com/articles/malformed-date/",
          sourcePublishedAt: "yesterday-ish",
        }),
        candidate({
          url: "https://www.pushsquare.com/news/crimson-desert-dated-last",
          sourceDomain: "pushsquare.com",
          sourcePublishedAt: "2026-07-16T10:00:00.000Z",
        }),
        // The wire's real date format (RFC 1123) counts as dated here too —
        // the same predicate drives displacement and payload order.
        candidate({
          url: "https://www.pcgamer.com/crimson-desert-wire-dated/",
          sourceDomain: "pcgamer.com",
          sourcePublishedAt: "Thu, 16 Jul 2026 11:00:00 GMT",
        }),
        // Casts fine, renders never: a date past the skew window belongs in
        // the unrenderable class, judged at the row's own observedAt.
        candidate({
          url: "https://www.eurogamer.net/crimson-desert-future-dated",
          sourceDomain: "eurogamer.net",
          sourcePublishedAt: "2026-07-19T00:00:00.000Z",
        }),
      ],
      "1.13.01",
      report,
    );

    expect(report.errors).toEqual([]);
    const payload = rpcCalls[0].params.p_observations as { url: string; source_published_at: string | null }[];
    expect(payload.map((row) => row.url)).toEqual([
      "https://www.polygon.com/crimson-desert-dated-late/",
      "https://www.pushsquare.com/news/crimson-desert-dated-last",
      "https://www.pcgamer.com/crimson-desert-wire-dated/",
      "https://www.dsogaming.com/articles/undated-first/",
      "https://www.dsogaming.com/articles/malformed-date/",
      "https://www.eurogamer.net/crimson-desert-future-dated",
    ]);
    // The payload date contract: non-null means the Brief can render it. The
    // RPC's coalesce prefers the incoming date, so a malformed or future
    // date must arrive as NULL — never as a raw string that could replace or
    // squat on stored state.
    expect(payload.map((row) => row.source_published_at)).toEqual([
      "2026-07-16T09:00:00.000Z",
      "2026-07-16T10:00:00.000Z",
      "Thu, 16 Jul 2026 11:00:00 GMT",
      null,
      null,
      null,
    ]);
  });

  it("sends the latest fields needed to re-observe an existing row", async () => {
    const day21 = candidate({
      kind: "community_ask",
      title: "Day 21 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/",
      sourceDomain: "reddit.com",
    });
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ rpcCalls, rpcResult: { data: 0, error: null } }),
      [day21],
      "1.13.01",
      report,
    );
    expect(rpcCalls[0].params.p_observations).toEqual([
      expect.objectContaining({
        url_hash: observationConflictHash(day21),
        observed_at: day21.observedAt,
        title: day21.title,
        url: day21.url,
        snippet: day21.snippet,
      }),
    ]);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("keeps a repeated source scoped to the requested patch", async () => {
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    const observation = candidate({ observedAt: "2026-07-20T12:00:00.000Z" });

    await persistObservations(stubClient({ rpcCalls }), [observation], "1.13.01", report);

    expect(rpcCalls[0].params).toMatchObject({ p_patch_version: "1.13.01" });
    expect(rpcCalls[0].params.p_observations).toEqual([
      expect.objectContaining({ url_hash: observationConflictHash(observation) }),
    ]);
    expect(report.observationsKept).toBe(1);
  });

  it("lets the database report zero inserts when the atomic patch cap is full", async () => {
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ rpcCalls, rpcResult: { data: 0, error: null } }),
      [candidate()],
      "1.13.01",
      report,
    );
    expect(rpcCalls).toHaveLength(1);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("deduplicates repeated candidates before calling the database", async () => {
    const rpcCalls: RpcCall[] = [];
    const day20 = candidate({
      kind: "community_ask",
      title: "Day 20 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/aaa/day_20/",
      sourceDomain: "reddit.com",
    });
    const day21 = candidate({
      kind: "community_ask",
      title: "Day 21 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/",
      sourceDomain: "reddit.com",
    });
    const report = { errors: [] as string[], observationsKept: 0 };

    await persistObservations(stubClient({ rpcCalls }), [day20, day21], "1.13.01", report);

    expect(rpcCalls[0].params.p_observations).toHaveLength(1);
    expect(rpcCalls[0].params.p_observations).toEqual([
      expect.objectContaining({ title: day20.title, url_hash: observationConflictHash(day20) }),
    ]);
  });

  it("degrades to an error note when the persistence function is unavailable, never throws", async () => {
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ rpcCalls, rpcResult: { data: null, error: { message: "function does not exist" } } }),
      [candidate()],
      "1.13.01",
      report,
    );
    expect(rpcCalls).toHaveLength(1);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual(["observation persistence failed: function does not exist"]);
  });

  it("does not call the database for an empty observation batch", async () => {
    const rpcCalls: RpcCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient({ rpcCalls }), [], "1.13.01", report);
    expect(rpcCalls).toHaveLength(0);
    expect(report).toEqual({ errors: [], observationsKept: 0 });
  });
});

describe("community ask genre", () => {
  it("tags a fresh feature-request campaign as community_ask", () => {
    const decision = preScreenCandidate(
      {
        title: "Day 20 of asking to add caracals to the desert : r/CrimsonDesert",
        snippet: "Still no caracals. The desert needs its cats.",
        sourceDomain: "reddit.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toMatchObject({ keep: false, observationKind: "community_ask" });
  });

  it("does NOT hijack a bug campaign — symptom language stays a complaint", () => {
    const decision = preScreenCandidate(
      {
        title: "Day 20 of asking to fix the crashes in the wyvern nest",
        snippet: "The game still crashes every time since the patch.",
        sourceDomain: "reddit.com",
      },
      PATCH_OPTIONS,
    );
    expect(decision).toEqual({ keep: true });
  });

  it("ignores stale asks older than the freshness window", () => {
    const decision = preScreenCandidate(
      {
        title: "Please add caracals to the desert",
        snippet: "An old wishlist thread.",
        sourceDomain: "reddit.com",
        sourcePublishedAt: "2026-05-01T00:00:00.000Z",
      },
      PATCH_OPTIONS,
    );
    expect((decision as { observationKind?: string }).observationKind).toBeUndefined();
  });
});
