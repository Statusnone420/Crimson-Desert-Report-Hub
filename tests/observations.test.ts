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
