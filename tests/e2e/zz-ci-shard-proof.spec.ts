import { expect, test } from "@playwright/test";

// Temporary: proves that one failed shard fails the required browser check.
// The next commit reverts this file.
test("deliberate failure for the CI shard proof", async () => {
  test.skip(test.info().project.name !== "chromium", "One failing shard is enough.");
  expect(1, "This test fails on purpose.").toBe(2);
});
