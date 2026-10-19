import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

test("the browser fixture never forwards OpenRouter requests and preserves local fixture traffic", () => {
  // Isolate the preload's frozen clock from the unit-test worker. The original
  // fetch is a recording stub, so a regression cannot contact a real provider.
  const preload = pathToFileURL(path.resolve("tests/e2e/fixture-preload.mjs")).href;
  const script = `
    import assert from "node:assert/strict";
    const forwarded = [];
    global.fetch = async (input) => {
      forwarded.push(input instanceof Request ? input.url : String(input));
      return Response.json({ fixture: true });
    };
    await import(${JSON.stringify(preload)});
    const requests = [
      ["https://openrouter.ai/api/v1/key", undefined],
      ["https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer fixture-secret" }, body: "fixture-prompt" }],
      [new Request("https://openrouter.ai/api/v1/generation?id=fixture"), undefined],
      [new URL("https://OPENROUTER.AI:443/api/v1/key"), undefined],
      ["https://api.openrouter.ai/api/v1/chat/completions", { method: "POST" }],
    ];
    for (const [input, options] of requests) {
      const response = await fetch(input, options);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: { code: 401, message: "OpenRouter is disabled in fixture tests" } });
    }
    assert.deepEqual(forwarded, []);
    const local = "http://127.0.0.1:18765/rest/v1/automation_runs";
    assert.deepEqual(await (await fetch(local)).json(), { fixture: true });
    const turnstile = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: "mock-turnstile-secret", response: "stub-token-fixture" }),
    });
    assert.deepEqual(await turnstile.json(), { success: true, hostname: "crimsonreporthub.com" });
    const problemOptions = { method: "POST", body: new URLSearchParams({ secret: "mock-problem-turnstile-secret", response: "stub-problem-fixture" }) };
    const problem = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", problemOptions);
    assert.deepEqual(await problem.json(), { success: true, hostname: "crimsonreporthub.com", action: "problem_report" });
    // Matches the observed provider: a replayed token still verifies here.
    const replay = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", problemOptions);
    assert.deepEqual(await replay.json(), { success: true, hostname: "crimsonreporthub.com", action: "problem_report" });
    assert.deepEqual(forwarded, [local]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});

test("the browser fixture's dev process keeps idle sockets open until their client closes them", () => {
  // Without this, a test client can reuse a keep-alive socket just as the server times it out.
  const preload = pathToFileURL(path.resolve("tests/e2e/fixture-preload.mjs")).href;
  const script = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    await import(${JSON.stringify(preload)});
    // Next creates its server through CommonJS require("http").
    const http = createRequire(import.meta.url)("http");
    assert.equal(http.createServer().keepAliveTimeout, 0);
    assert.equal(http.createServer(() => {}).keepAliveTimeout, 0);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
