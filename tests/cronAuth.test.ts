import { describe, expect, it } from "vitest";
import { hasCronAuthorization } from "@/lib/cronAuth";

const request = (authorization?: string) =>
  new Request("https://example.com/api/cron/keepalive", authorization === undefined ? {} : { headers: { authorization } });

describe("hasCronAuthorization", () => {
  it("accepts exactly the configured bearer token", () => {
    expect(hasCronAuthorization(request("Bearer cron-secret"), "cron-secret")).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer other-secret"],
    ["a longer secret with the right prefix", "Bearer cron-secret-extra"],
    ["a shorter prefix of the secret", "Bearer cron"],
    ["another scheme", "Basic cron-secret"],
    ["a lowercase scheme", "bearer cron-secret"],
    ["the bare secret", "cron-secret"],
  ])("refuses %s", (_label, authorization) => {
    expect(hasCronAuthorization(request(authorization), "cron-secret")).toBe(false);
  });
});
