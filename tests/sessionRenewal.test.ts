import { describe, expect, it, vi } from "vitest";
import { RENEWAL_RETRY_DELAY_MS, renewAdminSession } from "@/lib/sessionRenewal";

function replies(...outcomes: Array<number | Error>) {
  const request = vi.fn<() => Promise<Response>>();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) request.mockRejectedValueOnce(outcome);
    else request.mockResolvedValueOnce(new Response(null, { status: outcome }));
  }
  return request;
}

describe("admin session renewal from the browser", () => {
  it.each([204, 401])("settles on a first answer of %s without retrying", async (status) => {
    const request = replies(status);
    const wait = vi.fn(async () => undefined);
    await expect(renewAdminSession(request, wait)).resolves.toBe("done");
    expect(request).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries an unavailable renewal once after a pause", async () => {
    const request = replies(503, 204);
    const wait = vi.fn(async () => undefined);
    await expect(renewAdminSession(request, wait)).resolves.toBe("done");
    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(RENEWAL_RETRY_DELAY_MS);
  });

  it.each([[503, 503], [new Error("offline"), new Error("offline")], [500, new Error("offline")]])(
    "reports %s then %s as unavailable instead of dropping it",
    async (first, second) => {
      const request = replies(first, second);
      await expect(renewAdminSession(request, async () => undefined)).resolves.toBe("unavailable");
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
});
