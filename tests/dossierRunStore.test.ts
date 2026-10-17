import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDossierRunWorkspace } from "@/lib/dossierRunStore";

function clientWithResults(...results: Array<{ data: unknown; error: { message: string } | null }>) {
  const eq = vi.fn();
  const from = vi.fn(() => {
    const result = results.shift();
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      eq: vi.fn((...args: unknown[]) => {
        eq(...args);
        return query;
      }),
      limit: vi.fn(() => Promise.resolve(result)),
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from, eq };
}

describe("readDossierRunWorkspace", () => {
  it("treats an invalid requested UUID as missing without querying it", async () => {
    const { client, from, eq } = clientWithResults({ data: [], error: null });

    await expect(readDossierRunWorkspace(client, "not-a-saved-run")).resolves.toEqual({
      runs: [],
      selected: null,
      requestedRunMissing: true,
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(eq).not.toHaveBeenCalled();
  });

  it("preserves a valid selected-run query failure", async () => {
    const { client, eq } = clientWithResults(
      { data: [], error: null },
      { data: null, error: { message: "permission denied" } },
    );

    await expect(readDossierRunWorkspace(client, "718d42d9-f275-4eb3-924f-53c31a909d1f"))
      .rejects.toThrow("dossier run read failed: permission denied");
    expect(eq).toHaveBeenCalledWith("id", "718d42d9-f275-4eb3-924f-53c31a909d1f");
  });

  it("preserves a history query failure", async () => {
    const { client } = clientWithResults({ data: null, error: { message: "history unavailable" } });

    await expect(readDossierRunWorkspace(client))
      .rejects.toThrow("dossier run history read failed: history unavailable");
  });
});
