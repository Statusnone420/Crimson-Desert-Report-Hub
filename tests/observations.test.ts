import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_OBSERVATIONS_PER_PATCH,
  MAX_OBSERVATIONS_PER_RUN,
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

function stubClient(existingCount: number, upserts: UpsertCall[], failCount = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve(
            failCount
              ? { count: null, error: { message: "table missing" } }
              : { count: existingCount, error: null },
          ),
      }),
      upsert: (rows: Record<string, unknown>[], options: Record<string, unknown>) => {
        upserts.push({ rows, options });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as Pick<SupabaseClient, "from">;
}

describe("persistObservations", () => {
  it("writes observations under the per-patch cap and counts them", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient(0, upserts), [candidate()], "1.13.01", report);
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

  it("stops writing at the per-patch cap", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient(MAX_OBSERVATIONS_PER_PATCH, upserts), [candidate()], "1.13.01", report);
    expect(upserts).toHaveLength(0);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("degrades to an error note when the table is unreadable, never throws", async () => {
    const upserts: UpsertCall[] = [];
    const report = { errors: [] as string[], observationsKept: 0 };
    await persistObservations(stubClient(0, upserts, true), [candidate()], "1.13.01", report);
    expect(upserts).toHaveLength(0);
    expect(report.observationsKept).toBe(0);
    expect(report.errors).toHaveLength(1);
  });
});
