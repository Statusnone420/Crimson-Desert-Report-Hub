import { expect, test } from "@playwright/test";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
// Check-ins answer an official fix claim; this fixture issue has one.
const MAP_ISSUE_ID = "00000000-0000-4000-8000-000000000002";

// Real Siteverify accepted one token many times, and the fixture's Siteverify
// stub accepts any stub token the same way. Only the database can refuse reuse.
// API calls only: rendering a page here would cache it for the next spec.
test("a Turnstile token saves one check-in, whichever network sends it", async ({ page, baseURL }) => {
  const send = (network: number, token: string) => page.request.post("/api/confirmations", {
    headers: { origin: baseURL!, "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${60 + network}` },
    data: { cluster_id: MAP_ISSUE_ID, patch_version: "1.13.01", platform: "ps5", kind: "still_happening", turnstile_token: token },
  });
  const run = Math.random().toString(36).slice(2);

  try {
    const saved = await send(0, `stub-token-replay-${run}`);
    expect(saved.status()).toBe(201);
    const savedTotals = (await saved.json()).counts;
    expect(savedTotals?.still_happening).toEqual(expect.any(Number));

    const replays = await Promise.all([1, 2, 3].map((network) => send(network, `stub-token-replay-${run}`)));
    for (const replay of replays) {
      expect(replay.status()).toBe(400);
      expect(await replay.json()).toEqual({ error: "captcha_failed" });
    }

    const burst = await Promise.all([4, 5, 6, 7].map((network) => send(network, `stub-token-burst-${run}`)));
    expect(burst.map((response) => response.status()).sort()).toEqual([201, 400, 400, 400]);
    // Two tokens, two networks, two answers: the replays added nothing.
    const winner = burst.find((response) => response.status() === 201)!;
    expect((await winner.json()).counts?.still_happening).toBe(savedTotals.still_happening + 1);
  } finally {
    const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
    expect(reset.ok(), "fixture reset failed — later projects would inherit this test's writes").toBe(true);
  }
});

// A thumb spends the same single-use token: once spent by a thumb, it saves nothing else.
test("a Turnstile token saves one thumb, and a thumb's token cannot save a check-in", async ({ page, baseURL }) => {
  const headers = (network: number) => ({ origin: baseURL!, "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${80 + network}` });
  const token = `stub-token-thumb-${Math.random().toString(36).slice(2)}`;

  try {
    const saved = await page.request.post("/api/thumbs", {
      headers: headers(0),
      data: { cluster_id: MAP_ISSUE_ID, patch_version: "1.13.01", direction: "up", turnstile_token: token },
    });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, direction: "up", patch_version: "1.13.01" });

    const replayedThumb = await page.request.post("/api/thumbs", {
      headers: headers(1),
      data: { cluster_id: MAP_ISSUE_ID, patch_version: "1.13.01", direction: "down", turnstile_token: token },
    });
    expect(replayedThumb.status()).toBe(400);
    expect(await replayedThumb.json()).toEqual({ error: "captcha_failed" });

    const replayedCheckin = await page.request.post("/api/confirmations", {
      headers: headers(2),
      data: { cluster_id: MAP_ISSUE_ID, patch_version: "1.13.01", platform: "ps5", kind: "still_happening", turnstile_token: token },
    });
    expect(replayedCheckin.status()).toBe(400);
    expect(await replayedCheckin.json()).toEqual({ error: "captcha_failed" });
  } finally {
    const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
    expect(reset.ok(), "fixture reset failed — later projects would inherit this test's writes").toBe(true);
  }
});
