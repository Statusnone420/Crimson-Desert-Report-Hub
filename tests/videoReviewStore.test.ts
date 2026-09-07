import { describe, expect, it } from "vitest";
import type { createServiceClient } from "@/lib/supabase";
import type { NormalizedVideoReviewCandidate } from "@/lib/videoReview";
import {
  DuplicateVideoReviewCandidate,
  StaleVideoReviewEdit,
  approveVideoReviewCandidate,
  insertVideoReviewCandidate,
  readVideoReviewQueue,
  skipVideoReviewCandidate,
  updateVideoReviewCandidate,
} from "@/lib/videoReviewStore";

type Row = Record<string, unknown>;

const candidate: NormalizedVideoReviewCandidate = {
  videoId: "zzInboxMock",
  canonicalUrl: "https://www.youtube.com/watch?v=zzInboxMock",
  submittedUrl: "https://youtu.be/zzInboxMock",
  sourceId: "khraze-gaming",
  creatorChannelId: "UCFXUSG_393wZJaRTErU6Pjw",
  title: "Crimson Desert fixture commentary",
  channelLabel: "FixtureChannel",
  reviewNote: "Invented review note.",
  reviewedHeadline: "Fixture headline",
  reviewedExcerpt: "Crimson Desert fixture excerpt.",
  excerptReviewStatus: "reviewed",
  topic: "expansion",
  publishedAt: "2026-07-18",
};

function createTables(seed: { candidates?: Row[]; drafts?: Row[] } = {}) {
  const candidates = [...(seed.candidates ?? [])];
  const drafts = [...(seed.drafts ?? [])];
  return { candidates, drafts };
}

function matches(row: Row, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

function tableApi(rows: Row[], options: { unique?: string; bumpRevision?: boolean } = {}) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    insert: (payload: Row) => {
      if (options.unique && rows.some((row) => row[options.unique!] === payload[options.unique!])) {
        return {
          select: () => ({
            limit: () => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }),
          }),
        };
      }
      const row = {
        id: payload.id ?? `row-${rows.length + 1}`,
        created_at: "2026-07-20T00:10:00.000Z",
        updated_at: "2026-07-20T00:10:00.000Z",
        revision: 1,
        state: "pending",
        skipped_at: null,
        approved_at: null,
        ...payload,
      };
      rows.push(row);
      return { select: () => ({ limit: () => Promise.resolve({ data: [row], error: null }) }) };
    },
    upsert: (payload: Row) => {
      const existing = rows.find((row) => row.candidate_id === payload.candidate_id);
      if (existing) Object.assign(existing, payload);
      else rows.push({ id: `draft-${rows.length + 1}`, ...payload });
      const saved = existing ?? rows[rows.length - 1];
      return { select: () => ({ limit: () => Promise.resolve({ data: [saved], error: null }) }) };
    },
    update: (payload: Row) => {
      builder.patch = payload;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    order: () => Promise.resolve({ data: rows.filter((row) => matches(row, filters)), error: null }),
    limit: () => finish(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => finish().then(resolve, reject),
    patch: null as Row | null,
  };
  function finish() {
    const matched = rows.filter((row) => matches(row, filters));
    if (builder.patch) {
      if (matched.length === 0) return Promise.resolve({ data: [], error: null });
      for (const row of matched) {
        Object.assign(row, builder.patch);
        if (options.bumpRevision) row.revision = Number(row.revision ?? 1) + 1;
      }
      return Promise.resolve({ data: matched, error: null });
    }
    return Promise.resolve({ data: matched, error: null });
  }
  return builder;
}

function stubClient(tables: ReturnType<typeof createTables>, errors: Record<string, { code?: string; message: string } | null> = {}) {
  return {
    from: (name: string) => {
      if (errors[name]) {
        const error = errors[name];
        const failing = {
          select: () => failing,
          insert: () => failing,
          upsert: () => failing,
          update: () => failing,
          eq: () => failing,
          order: () => Promise.resolve({ data: null, error }),
          limit: () => Promise.resolve({ data: null, error }),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve({ data: null, error }).then(resolve, reject),
        };
        return failing;
      }
      if (name === "video_review_candidates") return tableApi(tables.candidates, { unique: "video_id", bumpRevision: true });
      if (name === "video_publication_drafts") return tableApi(tables.drafts, { unique: "candidate_id" });
      throw new Error(`unexpected table ${name}`);
    },
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("video review store", () => {
  it("treats a missing relation as unavailable instead of an empty queue", async () => {
    const queue = await readVideoReviewQueue(
      stubClient(createTables(), {
        video_review_candidates: { code: "PGRST205", message: "relation video_review_candidates does not exist" },
      }),
    );
    expect(queue).toEqual({ status: "unavailable", reason: "schema_missing" });
  });

  it("throws on permission failures instead of fabricating an empty inbox", async () => {
    await expect(
      readVideoReviewQueue(
        stubClient(createTables(), {
          video_review_candidates: { code: "42501", message: "permission denied for table video_review_candidates" },
        }),
      ),
    ).rejects.toThrow("video review queue read failed");
  });

  it("rejects a second insert of the same video ID", async () => {
    const tables = createTables();
    await insertVideoReviewCandidate(stubClient(tables), candidate);
    await expect(insertVideoReviewCandidate(stubClient(tables), candidate)).rejects.toBeInstanceOf(
      DuplicateVideoReviewCandidate,
    );
    expect(tables.candidates).toHaveLength(1);
  });

  it("makes competing edits explicit and keeps approve/skip idempotent", async () => {
    const tables = createTables({
      candidates: [
        {
          id: "video-1",
          revision: 1,
          state: "pending",
          video_id: candidate.videoId,
          canonical_url: candidate.canonicalUrl,
          submitted_url: candidate.submittedUrl,
          source_id: candidate.sourceId,
          creator_channel_id: candidate.creatorChannelId,
          title: candidate.title,
          channel_label: candidate.channelLabel,
          review_note: candidate.reviewNote,
          reviewed_headline: candidate.reviewedHeadline,
          reviewed_excerpt: candidate.reviewedExcerpt,
          excerpt_review_status: candidate.excerptReviewStatus,
          topic: candidate.topic,
          published_at: candidate.publishedAt,
        },
      ],
    });
    const client = stubClient(tables);
    await expect(updateVideoReviewCandidate(client, "video-1", 9, candidate)).rejects.toBeInstanceOf(StaleVideoReviewEdit);
    const first = await approveVideoReviewCandidate(client, "video-1", 1);
    const second = await approveVideoReviewCandidate(client, "video-1", 1);
    expect(first.candidate.state).toBe("draft_ready");
    expect(second.candidate.id).toBe(first.candidate.id);
    expect(tables.drafts).toHaveLength(1);
    await expect(skipVideoReviewCandidate(client, "video-1", 99)).rejects.toThrow(/already has a publication draft/);
  });

  it("skips without creating a public draft", async () => {
    const tables = createTables({
      candidates: [{ id: "video-2", revision: 1, state: "pending", ...candidate, video_id: "zzSkipMock1" }],
    });
    const skipped = await skipVideoReviewCandidate(stubClient(tables), "video-2", 1);
    const again = await skipVideoReviewCandidate(stubClient(tables), "video-2", 1);
    expect(skipped.state).toBe("skipped");
    expect(again.state).toBe("skipped");
    expect(tables.drafts).toHaveLength(0);
  });
});
