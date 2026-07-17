import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_OBSERVATIONS_PER_PATCH,
  MAX_OBSERVATIONS_PER_RUN,
  normalizeAskSeriesTitle,
  observationConflictHash,
  observationUrlHash,
  persistObservations,
  shouldCollectObservation,
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
      shouldCollectObservation({ sourceDomain: "dsogaming.com", observationKind: "press_reception" }, 0),
    ).toBe(true);
  });

  it("rejects untrusted domains even with a genre", () => {
    expect(
      shouldCollectObservation({ sourceDomain: "instagram.com", observationKind: "patch_release" }, 0),
    ).toBe(false);
    expect(shouldCollectObservation({ sourceDomain: null, observationKind: "patch_release" }, 0)).toBe(false);
  });

  it("rejects candidates without a genre", () => {
    expect(shouldCollectObservation({ sourceDomain: "dsogaming.com" }, 0)).toBe(false);
  });

  it("enforces the per-run cap", () => {
    expect(
      shouldCollectObservation(
        { sourceDomain: "dsogaming.com", observationKind: "press_reception" },
        MAX_OBSERVATIONS_PER_RUN,
      ),
    ).toBe(false);
  });
});

type UpsertCall = { rows: Record<string, unknown>[]; options: Record<string, unknown> };
type UpdateCall = { patch: Record<string, unknown>; hash: string };

function stubClient({
  patchCount = 0,
  existingRows = [] as { url_hash: string; seen_count: number }[],
  upserts = [] as UpsertCall[],
  updates = [] as UpdateCall[],
  failCount = false,
} = {}) {
  return {
    from: () => ({
      select: (_columns: string, options?: { count?: string }) =>
        options?.count
          ? {
              eq: () =>
                Promise.resolve(
                  failCount
                    ? { count: null, error: { message: "table missing" } }
                    : { count: patchCount, error: null },
                ),
            }
          : {
              in: () => Promise.resolve({ data: existingRows, error: null }),
            },
      update: (patch: Record<string, unknown>) => ({
        eq: (_column: string, hash: string) => {
          updates.push({ patch, hash });
          return Promise.resolve({ error: null });
        },
      }),
      upsert: (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
        upserts.push({ rows, options });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as Pick<SupabaseClient, "from">;
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
});

describe("persistObservations", () => {
  it("writes observations under the per-patch cap and counts them", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient({ upserts }), [candidate()], "1.13.01", report);
    expect(report.errors).toEqual([]);
    expect(report.observationsKept).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows[0]).toMatchObject({
      patch_version: "1.13.01",
      kind: "press_reception",
      source_domain: "dsogaming.com",
      url_hash: observationUrlHash(candidate().url),
    });
    expect(upserts[0].options).toMatchObject({ onConflict: "url_hash", ignoreDuplicates: true });
  });

  it("re-observes an existing row: bumps seen_count and points at the latest post", async () => {
    const day21 = candidate({
      kind: "community_ask",
      title: "Day 21 of asking to add caracals to the desert : r/CrimsonDesert",
      url: "https://www.reddit.com/r/CrimsonDesert/comments/bbb/day_21/",
      sourceDomain: "reddit.com",
    });
    const upserts: UpsertCall[] = [];
    const updates: UpdateCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ existingRows: [{ url_hash: observationConflictHash(day21), seen_count: 5 }], upserts, updates }),
      [day21],
      "1.13.01",
      report,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ seen_count: 6, url: day21.url });
    expect(upserts).toHaveLength(0);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("stops writing at the per-patch cap", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(
      stubClient({ patchCount: MAX_OBSERVATIONS_PER_PATCH, upserts }),
      [candidate()],
      "1.13.01",
      report,
    );
    expect(upserts).toHaveLength(0);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("degrades to an error note when the table is unreadable, never throws", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient({ upserts, failCount: true }), [candidate()], "1.13.01", report);
    expect(upserts).toHaveLength(0);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toHaveLength(1);
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
