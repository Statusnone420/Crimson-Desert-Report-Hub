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
  const greaterThan: Record<string, string> = {};
  let orderedBy: { column: string; ascending: boolean } | null = null;
  let rowLimit: number | null = null;
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
    gt: (column: string, value: string) => {
      greaterThan[column] = value;
      return builder;
    },
    order: (column: string, options: { ascending?: boolean } = {}) => {
      orderedBy = { column, ascending: options.ascending ?? true };
      return builder;
    },
    limit: (value: number) => {
      rowLimit = value;
      return finish();
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => finish().then(resolve, reject),
    patch: null as Row | null,
  };
  function finish() {
    const matched = rows.filter((row) =>
      matches(row, filters) && Object.entries(greaterThan).every(([column, value]) => String(row[column]) > value),
    );
    if (builder.patch) {
      if (matched.length === 0) return Promise.resolve({ data: [], error: null });
      for (const row of matched) {
        Object.assign(row, builder.patch);
        if (options.bumpRevision) row.revision = Number(row.revision ?? 1) + 1;
      }
      return Promise.resolve({ data: matched, error: null });
    }
    const sorted = orderedBy
      ? [...matched].sort((a, b) => String(a[orderedBy!.column]).localeCompare(String(b[orderedBy!.column])) * (orderedBy!.ascending ? 1 : -1))
      : matched;
    return Promise.resolve({ data: rowLimit === null ? sorted : sorted.slice(0, rowLimit), error: null });
  }
  return builder;
}

function stubClient(tables: ReturnType<typeof createTables>, errors: Record<string, { code?: string; message: string } | null> = {}) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== "mutate_video_review_candidate") throw new Error(`unexpected RPC ${name}`);
      if (errors[name]) return { data: null, error: errors[name] };
      const row = tables.candidates.find((item) => item.id === args.p_id);
      if (!row) return { data: null, error: { message: "video_review_candidate_not_found" } };
      if (row.revision !== args.p_revision) return { data: null, error: { message: "stale_video_review_edit" } };
      const next = { ...row };
      let removeDraft = false;
      if (args.p_operation === "save") {
        const patch = args.p_candidate as Row;
        removeDraft = ["video_id", "source_id", "creator_channel_id"].some((key) => patch[key] !== row[key]);
        Object.assign(next, patch);
        if (removeDraft) Object.assign(next, { state: "pending", approved_at: null, skipped_at: null });
      } else if (args.p_operation === "approve") {
        Object.assign(next, { state: "draft_ready", approved_at: "2026-09-07T12:00:00Z" });
      } else {
        Object.assign(next, { state: "skipped", skipped_at: "2026-09-07T12:00:00Z" });
      }
      next.revision = Number(row.revision) + 1;
      Object.assign(row, next);
      if (removeDraft) tables.drafts.splice(0, tables.drafts.length, ...tables.drafts.filter((item) => item.candidate_id !== row.id));
      if (args.p_draft) {
        const payload = { ...(args.p_draft as Row), candidate_id: row.id };
        const existing = tables.drafts.find((item) => item.candidate_id === row.id);
        if (existing) Object.assign(existing, payload);
        else tables.drafts.push({ id: `draft-${tables.drafts.length + 1}`, ...payload });
      }
      return { data: { candidate: { ...row }, draft: tables.drafts.find((item) => item.candidate_id === row.id) ?? null }, error: null };
    },
    from: (name: string) => {
      if (errors[name]) {
        const error = errors[name];
        const failing = {
          select: () => failing,
          insert: () => failing,
          upsert: () => failing,
          update: () => failing,
          eq: () => failing,
          gt: () => failing,
          order: () => failing,
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

  it("returns an observation time with the private queue", async () => {
    const tables = createTables({
      candidates: [{ id: "video-1", revision: 1, state: "pending", ...candidate }],
    });
    const queue = await readVideoReviewQueue(stubClient(tables));
    expect(queue.status).toBe("ok");
    if (queue.status !== "ok") throw new Error("expected a readable queue");
    expect(queue.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(queue.candidates).toHaveLength(1);
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

type QueuePage = { table: string; after: string | null; ordered: string[]; limit: number | null };

function paginatedQueueClient(
  tables: ReturnType<typeof createTables>,
  options: { cap: number; failAt?: { table: string; call: number; error: { code?: string; message: string } } },
) {
  const pages: QueuePage[] = [];
  const calls: Record<string, number> = {};
  return {
    from: (table: string) => ({
      select: () => {
        const page: QueuePage = { table, after: null, ordered: [], limit: null };
        const builder = {
          gt: (column: string, value: string) => {
            expect(column).toBe("id");
            page.after = value;
            return builder;
          },
          order: (column: string) => {
            page.ordered.push(column);
            return builder;
          },
          limit: (value: number) => {
            page.limit = value;
            return builder;
          },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            pages.push(page);
            calls[table] = (calls[table] ?? 0) + 1;
            if (options.failAt?.table === table && options.failAt.call === calls[table]) {
              return Promise.resolve({ data: null, error: options.failAt.error }).then(resolve, reject);
            }
            const source = table === "video_review_candidates" ? tables.candidates : tables.drafts;
            const data = source
              .filter((row) => page.after === null || String(row.id) > page.after)
              .sort((a, b) => String(a.id).localeCompare(String(b.id)))
              .slice(0, Math.min(page.limit ?? 0, options.cap));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    }),
    pages: () => pages,
  } as unknown as ReturnType<typeof createServiceClient> & { pages: () => QueuePage[] };
}

function queueId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function queueCandidate(index: number, createdAt: string): Row {
  return { id: queueId(index), created_at: createdAt };
}

function queueDraft(index: number): Row {
  return { id: queueId(index), candidate_id: `candidate-${index}` };
}

describe("video review queue pagination", () => {
  it("walks capped candidate and draft pages to empty, then sorts candidates by created_at and id", async () => {
    const tables = createTables({
      candidates: Array.from({ length: 1001 }, (_, offset) => {
        const index = offset + 1;
        return queueCandidate(index, index <= 2 ? "2026-09-01T00:00:00.000Z" : "2026-09-02T00:00:00.000Z");
      }).reverse(),
      drafts: Array.from({ length: 1003 }, (_, offset) => queueDraft(offset + 1)).reverse(),
    });
    const client = paginatedQueueClient(tables, { cap: 400 });

    const queue = await readVideoReviewQueue(client);

    expect(queue.status).toBe("ok");
    if (queue.status !== "ok") throw new Error("expected a readable queue");
    expect(queue.candidates).toHaveLength(1001);
    expect(queue.candidates.slice(0, 2).map((row) => row.id)).toEqual([queueId(1), queueId(2)]);
    expect(Object.keys(queue.draftsByCandidateId)).toHaveLength(1003);
    expect(queue.draftsByCandidateId["candidate-1003"].id).toBe(queueId(1003));

    const pages = (client as unknown as { pages: () => QueuePage[] }).pages();
    expect(pages.filter((page) => page.table === "video_review_candidates")).toHaveLength(4);
    expect(pages.filter((page) => page.table === "video_publication_drafts")).toHaveLength(4);
    for (const page of pages) {
      expect(page.ordered).toEqual(["id"]);
      expect(page.limit).toBe(1000);
    }
  });

  it("surfaces a failure on a later candidate page instead of returning a partial queue", async () => {
    const tables = createTables({
      candidates: Array.from({ length: 1001 }, (_, offset) => queueCandidate(offset + 1, "2026-09-01T00:00:00.000Z")),
    });
    const client = paginatedQueueClient(tables, {
      cap: 1000,
      failAt: { table: "video_review_candidates", call: 2, error: { code: "42501", message: "permission denied" } },
    });

    await expect(readVideoReviewQueue(client)).rejects.toThrow("video review queue read failed: permission denied");
    expect((client as unknown as { pages: () => QueuePage[] }).pages()).toHaveLength(2);
  });
});


describe("atomic video-review client contract", () => {
  const validCandidate = { ...candidate, videoId: "abcdefghijk", canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", submittedUrl: "https://youtu.be/abcdefghijk" };

  it("does not separately mark a candidate approved when the transaction fails", async () => {
    const tables = createTables();
    const good = stubClient(tables);
    const row = await insertVideoReviewCandidate(good, validCandidate);
    const failing = stubClient(tables, { mutate_video_review_candidate: { message: "draft constraint failed" } });
    await expect(approveVideoReviewCandidate(failing, row.id, row.revision)).rejects.toThrow("draft constraint failed");
    expect(tables.candidates[0].state).toBe("pending");
    expect(tables.drafts).toHaveLength(0);
  });

  it("requires a new approval after changing the approved video's identity", async () => {
    const tables = createTables();
    const client = stubClient(tables);
    const row = await insertVideoReviewCandidate(client, validCandidate);
    const approved = await approveVideoReviewCandidate(client, row.id, row.revision);
    const changed = await updateVideoReviewCandidate(client, row.id, approved.candidate.revision, { ...validCandidate, videoId: "lmnopqrstuv", canonicalUrl: "https://www.youtube.com/watch?v=lmnopqrstuv", submittedUrl: "https://youtu.be/lmnopqrstuv" });
    expect(changed.state).toBe("pending");
    expect(changed.approved_at).toBeNull();
    expect(tables.drafts).toHaveLength(0);
    const reapproved = await approveVideoReviewCandidate(client, row.id, changed.revision);
    expect(reapproved.draft.video_id).toBe("lmnopqrstuv");
  });

  it("refreshes same-video metadata and its draft together", async () => {
    const tables = createTables();
    const client = stubClient(tables);
    const row = await insertVideoReviewCandidate(client, validCandidate);
    const approved = await approveVideoReviewCandidate(client, row.id, row.revision);
    const changed = await updateVideoReviewCandidate(client, row.id, approved.candidate.revision, { ...validCandidate, title: "Corrected Crimson Desert title" });
    expect(changed.state).toBe("draft_ready");
    expect(tables.drafts[0].markdown).toContain("Corrected Crimson Desert title");
    const repeated = await approveVideoReviewCandidate(client, row.id, 1);
    expect(repeated.candidate.revision).toBe(changed.revision);
    expect(tables.drafts).toHaveLength(1);
  });
});
