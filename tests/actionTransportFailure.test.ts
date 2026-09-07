import { describe, expect, it } from "vitest";
import { isActionTransportFailure } from "@/lib/actionTransportFailure";

describe("isActionTransportFailure", () => {
  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new DOMException("network went away", "NetworkError"),
  ])("recognizes browser action transport failures: %s", (error) => {
    expect(isActionTransportFailure(error)).toBe(true);
  });

  it.each([
    new Error("stale report decision"),
    new TypeError("Cannot read properties of undefined"),
    new Error("NEXT_REDIRECT"),
    "Failed to fetch",
  ])("does not classify server or programming errors: %s", (error) => {
    expect(isActionTransportFailure(error)).toBe(false);
  });
});
