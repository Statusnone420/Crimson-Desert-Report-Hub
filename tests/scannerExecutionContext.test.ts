import { afterEach, describe, expect, it, vi } from "vitest";
import { createScannerBoundedFetch, SCANNER_WORK_MS, withScannerEssential, withScannerExecution, withScannerRun } from "@/lib/automation/executionContext.server";

afterEach(() => vi.useRealTimers());
describe("scanner execution deadlines", () => {
  it("bounds a response body that stalls after headers", async () => {
    vi.useFakeTimers();
    const response = new Response("fixture");
    vi.spyOn(response, "arrayBuffer").mockImplementation(() => new Promise(() => {}));
    const request = withScannerExecution(() => createScannerBoundedFetch(vi.fn(async () => response))("https://database.test"));
    const observed = request.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await observed).toMatch(/timed out/);
  });
  it("keeps essential finalization available after the work deadline", async () => {
    vi.useFakeTimers();
    const fetcher = createScannerBoundedFetch(vi.fn(async () => new Response("{}")));
    await withScannerExecution(async () => {
      await vi.advanceTimersByTimeAsync(SCANNER_WORK_MS + 1);
      await expect(fetcher("https://database.test")).rejects.toThrow("deadline expired");
      expect((await withScannerEssential(() => fetcher("https://database.test"))).status).toBe(200);
    });
  });
  it("looks up each invocation's context inside a cached fetch wrapper", async () => {
    const seen: string[] = [];
    const fetcher = createScannerBoundedFetch(vi.fn(async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-scanner-run-id") ?? "none");
      await Promise.resolve();
      return new Response("{}");
    }));
    await Promise.all(["run-a", "run-b"].map((id) => withScannerExecution(() => withScannerRun({ id, token: `${id}-private` }, async () => {
      await Promise.resolve();
      await fetcher("https://database.test");
    }))));
    expect(seen.sort()).toEqual(["run-a", "run-b"]);
    await fetcher("https://database.test");
    expect(seen.at(-1)).toBe("none");
  });
  it("keeps private execution headers out of external provider requests", async () => {
    const native = vi.fn<typeof fetch>(async () => new Response("{}"));
    await withScannerExecution(() => withScannerRun({ id: "fixture", token: "private-token" }, () =>
      createScannerBoundedFetch(native, { sourceHeaders: false })("https://provider.test")));
    const headers = new Headers(native.mock.calls[0]?.[1]?.headers);
    expect(headers.has("x-scanner-execution-token")).toBe(false);
  });
});
