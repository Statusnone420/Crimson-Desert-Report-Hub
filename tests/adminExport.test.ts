import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/adminGuard", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServiceClient: vi.fn() }));

import { GET } from "@/app/api/admin/export/route";
import { isAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

type Row = Record<string, unknown>;
type PageResult = { data: Row[] | null; error: { message: string } | null };
type RangeCall = { from: number; to: number; orders: [string, boolean][] };

/**
 * Each page request records its range bounds and the order clauses that were
 * chained before it, so the tests can pin the deterministic created_at, id
 * paging the confirm step's "all rows" promise depends on.
 */
function stubPagedClient(pages: PageResult[]): { calls: RangeCall[] } {
  const calls: RangeCall[] = [];
  vi.mocked(createServiceClient).mockReturnValue({
    from: () => {
      const orders: [string, boolean][] = [];
      const builder = {
        select: () => builder,
        order: (column: string, opts: { ascending: boolean }) => {
          orders.push([column, opts.ascending]);
          return builder;
        },
        range: (from: number, to: number) => {
          calls.push({ from, to, orders });
          return Promise.resolve(pages[calls.length - 1] ?? { data: [], error: null });
        },
      };
      return builder;
    },
  } as unknown as ReturnType<typeof createServiceClient>);
  return { calls };
}

function makeRows(start: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `report-${String(start + index).padStart(5, "0")}`,
    issue_title: `Issue ${start + index}`,
  }));
}

describe("admin CSV export route", () => {
  beforeEach(() => {
    vi.mocked(isAdmin).mockReset();
    vi.mocked(createServiceClient).mockReset();
    vi.mocked(isAdmin).mockResolvedValue(true);
  });

  it("rejects without an admin session and reads nothing", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    const { calls } = stubPagedClient([]);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("assembles every page beyond the hosted row cap in stable created_at, id order", async () => {
    const { calls } = stubPagedClient([
      { data: makeRows(0, 1000), error: null },
      { data: makeRows(1000, 2), error: null },
    ]);

    const response = await GET();
    const lines = (await response.text()).split("\r\n");

    expect(response.status).toBe(200);
    // Header plus all 1,002 rows across both pages, in page order.
    expect(lines).toHaveLength(1003);
    expect(lines[1]).toContain("report-00000");
    expect(lines[1002]).toContain("report-01001");
    expect(calls.map(({ from, to }) => [from, to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    for (const call of calls) {
      expect(call.orders).toEqual([
        ["created_at", true],
        ["id", true],
      ]);
    }
  });

  it("fails the request when a later page read fails, never a silently truncated file", async () => {
    stubPagedClient([
      { data: makeRows(0, 1000), error: null },
      { data: null, error: { message: "boom" } },
    ]);

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toContain("text/csv");
  });

  it("neutralizes player-supplied formula cells before they reach the file", async () => {
    stubPagedClient([{ data: [{ id: "report-1", issue_title: "=2+5+IMPORTDATA(evil)" }], error: null }]);

    const response = await GET();
    const text = await response.text();

    expect(text).toContain(",'=2+5+IMPORTDATA(evil)");
    expect(text).not.toContain(",=2+5+IMPORTDATA(evil)");
  });

  it("returns a single short page without requesting a second one", async () => {
    const { calls } = stubPagedClient([{ data: makeRows(0, 3), error: null }]);

    const response = await GET();
    const lines = (await response.text()).split("\r\n");

    expect(response.status).toBe(200);
    expect(lines).toHaveLength(4);
    expect(calls).toHaveLength(1);
  });
});
