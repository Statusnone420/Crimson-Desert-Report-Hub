import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readExcerptsByClusterForCurrentPatch } from "@/lib/queries";

type Report = {
  id: string;
  cluster_id: string;
  platform: string;
  patch_version: string;
  moderation_status: "approved" | "pending" | "rejected" | "spam";
};
type Excerpt = { report_id: string; excerpt_text: string; created_at: string };

const patch = { version: "2.03.00", publishedAt: "2026-09-18T00:00:00Z" };
const report = (id: string): Report => ({
  id, cluster_id: "public-cluster", platform: "pc_steam", patch_version: patch.version, moderation_status: "approved",
});
const excerpt = (id: string): Excerpt => ({
  report_id: id, excerpt_text: `Excerpt for ${id}`, created_at: "2026-10-01T00:00:00Z",
});

/** Real Supabase query serialization with an offline PostgREST embed fixture. */
function excerptClient(reports: Report[], excerpts: Excerpt[]) {
  const requests: Request[] = [];
  const client = createClient("https://excerpts.test", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      expect(request.method).toBe("GET");
      expect(url.pathname).toBe("/rest/v1/approved_excerpts");
      const query = url.searchParams;
      const embed = query.get("select")?.match(/bug_reports(!inner)?\(([^)]+)\)/);
      if (!embed) throw new Error("Expected a report relationship projection");
      const statusFilter = query.get("bug_reports.moderation_status");
      const rows = excerpts.flatMap((saved) => {
        const related = reports.find((row) => row.id === saved.report_id);
        const matches = related && (!statusFilter || statusFilter === `eq.${related.moderation_status}`);
        // PostgREST filters the embedded row first. Only !inner also removes
        // the parent excerpt when its report is missing or fails the filter.
        if (!matches && embed[1]) return [];
        return [{
          excerpt_text: saved.excerpt_text,
          created_at: saved.created_at,
          bug_reports: matches
            ? Object.fromEntries(embed[2].split(",").map((key) => [key, related[key as keyof Report]]))
            : null,
        }];
      });
      rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const offset = Number(query.get("offset") ?? 0);
      const limit = Number(query.get("limit") ?? rows.length);
      return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {
        headers: { "content-type": "application/json" },
      });
    } },
  });
  return { client, requests };
}

describe("public excerpt withdrawal", () => {
  it.each(["rejected", "spam"] as const)("withdraws an approved report's excerpt after it becomes %s", async (status) => {
    const withdrawing = report("withdrawing");
    const backing = report("still-approved");
    const publicCluster = { id: backing.cluster_id, is_public: true };
    const saved = [excerpt(withdrawing.id), excerpt(backing.id)];
    const historicalExcerpts = structuredClone(saved);
    const { client, requests } = excerptClient([withdrawing, backing], saved);
    const read = () => readExcerptsByClusterForCurrentPatch(client, patch);

    expect((await read())[publicCluster.id]).toEqual([
      { text: saved[0].excerpt_text, platform: "pc_steam" },
      { text: saved[1].excerpt_text, platform: "pc_steam" },
    ]);

    withdrawing.moderation_status = status;
    // Another approved report keeps the same issue public independently.
    expect(backing.moderation_status).toBe("approved");
    expect(publicCluster.is_public).toBe(true);
    expect((await read())[publicCluster.id]).toEqual([
      { text: saved[1].excerpt_text, platform: "pc_steam" },
    ]);
    expect(saved).toEqual(historicalExcerpts);
    expect(requests).toHaveLength(2);
    const query = new URL(requests[1].url).searchParams;
    expect(query.get("select")).toBe("excerpt_text,created_at,bug_reports!inner(cluster_id,platform,patch_version)");
    expect(query.get("bug_reports.moderation_status")).toBe("eq.approved");
  });

  it("filters non-approved and missing reports before paging without exposing moderation fields", async () => {
    const withdrawn = Array.from({ length: 1000 }, (_, index) => ({
      ...report(`withdrawn-${index}`), moderation_status: "pending" as const,
    }));
    const approved = report("approved");
    const saved = [...withdrawn.map((row) => excerpt(row.id)), excerpt("missing-report"), excerpt(approved.id)];
    const { client, requests } = excerptClient([...withdrawn, approved], saved);

    expect(await readExcerptsByClusterForCurrentPatch(client, patch)).toEqual({
      [approved.cluster_id]: [{ text: "Excerpt for approved", platform: "pc_steam" }],
    });
    expect(requests).toHaveLength(1);
    expect(saved).toHaveLength(1002);
  });
});
