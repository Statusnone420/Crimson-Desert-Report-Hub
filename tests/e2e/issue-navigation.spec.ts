import { expect, test, type Page } from "@playwright/test";

import { refreshFixtureReads, signInAsAdmin, waitForHydration } from "./helpers";
import { choosePlatform, installTurnstile } from "./checkin-helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const CANDIDATE_ONLY_ID = "00000000-0000-4000-8000-000000000099";
const CANDIDATE_ONLY_TOPIC = { id: CANDIDATE_ONLY_ID, slug: "candidate-only-watchlist", title: "Candidate-only watchlist check-in", signalId: "candidate-only-signal" };
const SECOND_CANDIDATE_TOPIC = { id: "00000000-0000-4000-8000-000000000098", slug: "second-candidate-watchlist", title: "Second candidate-only watchlist topic", signalId: "second-candidate-signal" };

async function revalidatePublicIssues(page: Page) {
  await refreshFixtureReads(page);
}

async function seedCandidateOnlyWatchlist(page: Page, topic = CANDIDATE_ONLY_TOPIC) {
  const cluster = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_clusters`, {
    data: {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      category: "performance",
      description: "A public candidate-only fixture for deep-link selection.",
      fix_status: "reported",
      confidence: "low",
      is_public: true,
      admin_override: false,
    },
  });
  expect(cluster.ok(), "candidate-only cluster fixture insert failed").toBe(true);

  const signal = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/source_signals`, {
    data: {
      id: topic.signalId,
      cluster_id: topic.id,
      source: "web_search",
      source_type: "web_search",
      source_url: `https://community.example/crimson-desert/${topic.slug}`,
      title: "Crimson Desert candidate-only performance question",
      summary: "Crimson Desert players are asking about a performance issue after patch 1.13.01.",
      source_published_at: "2026-07-19T12:00:00.000Z",
      public_status: "private",
      category: "performance",
      confidence: "low",
      observed_at: "2026-07-19T12:00:00.000Z",
    },
  });
  expect(signal.ok(), "candidate-only signal fixture insert failed").toBe(true);
}

test.describe("mutating issue navigation fixture", () => {
  test.describe.configure({ mode: "serial" });

  test("an empty published board opens available watchlist topics without setting a filter", async ({ page }, testInfo) => {
    await signInAsAdmin(page);
    try {
      await seedCandidateOnlyWatchlist(page);
      const response = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_clusters?select=id`);
      expect(response.ok()).toBe(true);
      for (const cluster of await response.json() as { id: string }[]) {
        if (cluster.id === CANDIDATE_ONLY_ID) continue;
        const hidden = await page.request.patch(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_clusters?id=eq.${cluster.id}`, {
          data: { is_public: false, admin_visibility_override: "force_hidden" },
        });
        expect(hidden.ok()).toBe(true);
      }
      await revalidatePublicIssues(page);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(async () => {
          await page.goto("/issues");
          await waitForHydration(page);
          await expect(page.getByRole("button", { name: "Browse 1 watchlist topic", exact: true })).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
        const empty = await page.locator(".board-empty").boundingBox();
        const column = await page.locator(".player-dispatches").boundingBox();
        expect(Math.abs(empty!.width - column!.width)).toBeLessThan(2);
        await page.locator("#board").screenshot({ path: testInfo.outputPath(`empty-board-${width}.png`) });
        await page.getByRole("button", { name: "Browse 1 watchlist topic", exact: true }).click();
        const selected = page.getByRole("button", { name: "Watchlist 1", exact: true });
        await expect(selected).toHaveAttribute("aria-pressed", "true");
        await expect(selected).toBeFocused();
        await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("all");
        await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toBeDisabled();
        await expect(page.getByRole("heading", { name: "Candidate-only watchlist check-in", exact: true })).toBeVisible();
      }
    } finally {
      expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`)).ok()).toBe(true);
      await revalidatePublicIssues(page);
    }
  });

  for (const width of [1440, 390]) {
    test(`saved check-ins refresh server totals without reloading at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await installTurnstile(page);
      await signInAsAdmin(page);
      try {
        await seedCandidateOnlyWatchlist(page);
        await revalidatePublicIssues(page);
        await expect(async () => {
          await page.goto("/issues");
          await waitForHydration(page);
          await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
          await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });

        const card = page.locator(`#issue-${CANDIDATE_ONLY_ID}`);
        const notHappening = card.getByRole("button", { name: /^Not happening for me/ });
        await expect(notHappening.locator(".tap-btn__count")).toHaveText("0");
        for (let attempt = 0; attempt < 2; attempt++) {
          await choosePlatform(card, /^Not happening for me/);
          const posted = page.waitForResponse((response) => response.url().endsWith("/api/confirmations") && response.request().method() === "POST");
          await card.getByRole("button", { name: "Save check-in", exact: true }).click();
          expect((await posted).status()).toBe(201);
          await expect(card.getByText(/Saved for patch 1\.13\.01/)).toBeVisible();
          await expect(notHappening.locator(".tap-btn__count")).toHaveText("1");
        }

        await choosePlatform(card, /^Happening to me/);
        const replacement = page.waitForResponse((response) => response.url().endsWith("/api/confirmations") && response.request().method() === "POST");
        await card.getByRole("button", { name: "Save check-in", exact: true }).click();
        expect((await replacement).status()).toBe(201);
        await expect(card.getByRole("button", { name: /^Happening to me/ }).locator(".tap-btn__count")).toHaveText("1");
        await expect(notHappening.locator(".tap-btn__count")).toHaveText("0");
        await expect(card.getByText("1 check-in · Patch 1.13.01", { exact: true })).toBeVisible();
        await expect(card).toBeInViewport();
        await expect(card.getByRole("button", { name: /^Happening to me/ })).toBeFocused();
        await expect(card.getByRole("button", { name: /^Happening to me/ })).toBeInViewport();
        await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
        await expect(card).toHaveCount(0);
        await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ }).click();

        // With its lead withdrawn, the sole affected answer is the only reason
        // this issue has a full card. Replacing it must still show the receipt.
        const withdrawn = await page.request.patch(`${MOCK_SUPABASE_ORIGIN}/rest/v1/source_signals?id=eq.candidate-only-signal`, {
          data: { public_status: "hidden" },
        });
        expect(withdrawn.ok()).toBe(true);
        await choosePlatform(card, /^Not happening for me/);
        const lastAffected = page.waitForResponse((response) => response.url().endsWith("/api/confirmations") && response.request().method() === "POST");
        await card.getByRole("button", { name: "Save check-in", exact: true }).click();
        expect((await lastAffected).status()).toBe(201);
        await expect(notHappening.locator(".tap-btn__count")).toHaveText("1");
        await expect(card.getByRole("button", { name: /^Happening to me/ }).locator(".tap-btn__count")).toHaveText("0");
        await expect(card.getByText(/Saved for patch 1\.13\.01/)).toBeVisible();
        await expect(notHappening).toBeFocused();
        await expect(notHappening).toBeInViewport();

        // Client props are public even when the component hides their content.
        // A fresh reader must receive neither the title nor ID in HTML or RSC.
        // Immediate receipt totals no longer imply that the route refresh has
        // finished. Wait for the server to remove the topic from the board.
        await expect(card.getByText("Your check-in receipt. This topic is no longer on the public board.", { exact: true })).toBeVisible();
        const publicHeaders: Record<string, string>[] = [{}, { RSC: "1" }];
        for (const headers of publicHeaders) {
          const publicBoard = await request.get("/issues", { headers });
          expect(publicBoard.status()).toBe(200);
          expect(publicBoard.headers()["content-type"]).toContain(headers.RSC ? "text/x-component" : "text/html");
          const payload = await publicBoard.text();
          expect(payload).not.toContain(CANDIDATE_ONLY_ID);
          expect(payload).not.toContain("Candidate-only watchlist check-in");
        }

        // Keeping a receipt does not publish the monitored topic for everyone.
        await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ }).click();
        await expect(card).toHaveCount(0);
        await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
        await expect(card).toHaveCount(0);
        await page.reload();
        await expect(card).toHaveCount(0);
      } finally {
        const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
        expect(reset.ok()).toBe(true);
        await revalidatePublicIssues(page);
        await expect(async () => {
          await page.goto(`/issues#issue-${CANDIDATE_ONLY_ID}`);
          await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toHaveCount(0);
        }).toPass({ timeout: 30_000 });
      }
    });
  }

  for (const width of [1440, 390]) {
    test(`a replacement save survives a publication-changing refresh at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installTurnstile(page);
      await signInAsAdmin(page);
      let releaseRefresh!: () => void;
      let releasePost!: () => void;
      let refreshStarted!: () => void;
      const heldRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      const heldPost = new Promise<void>((resolve) => { releasePost = resolve; });
      const refreshing = new Promise<void>((resolve) => { refreshStarted = resolve; });
      try {
        await seedCandidateOnlyWatchlist(page);
        await revalidatePublicIssues(page);
        await expect(async () => {
          await page.goto("/issues");
          await waitForHydration(page);
          await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
          await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
        let refreshes = 0;
        let posts = 0;
        await page.route("**/issues?*", async (route) => {
          if (route.request().headers().rsc === "1" && ++refreshes === 1) { refreshStarted(); await heldRefresh; }
          await route.continue();
        });
        await page.route("**/api/confirmations", async (route) => {
          if (++posts === 2) await heldPost;
          await route.continue();
        });
        const card = page.locator(`#issue-${CANDIDATE_ONLY_ID}`);
        await choosePlatform(card, /^Happening to me/);
        await card.getByRole("button", { name: "Save check-in", exact: true }).click();
        await refreshing;
        await expect(card.getByRole("button", { name: /^Happening to me/ }).locator(".tap-btn__count")).toHaveText("1");
        await choosePlatform(card, /^Not happening for me/);
        await card.getByRole("button", { name: "Save check-in", exact: true }).click();
        await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
        releaseRefresh();
        await expect(card.locator(".dispatch-byline")).toContainText("1 check-in · Patch 1.13.01");
        const withdrawn = await page.request.patch(`${MOCK_SUPABASE_ORIGIN}/rest/v1/source_signals?id=eq.candidate-only-signal`, { data: { public_status: "hidden" } });
        expect(withdrawn.ok()).toBe(true);
        const saved = page.waitForResponse((response) => response.url().endsWith("/api/confirmations") && response.request().method() === "POST");
        releasePost();
        expect((await saved).status()).toBe(201);
        const answer = card.getByRole("button", { name: /^Not happening for me/ });
        await expect(answer).toHaveAttribute("aria-pressed", "true");
        await expect(answer.locator(".tap-btn__count")).toHaveText("1");
        await expect(card.getByText("Your check-in receipt. This topic is no longer on the public board.", { exact: true })).toBeVisible();
        await expect(answer).toBeFocused();
      } finally {
        releaseRefresh(); releasePost();
        await page.unrouteAll({ behavior: "wait" });
        const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
        expect(reset.ok()).toBe(true);
        await revalidatePublicIssues(page);
        await expect(async () => {
          await page.goto("/issues");
          await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toHaveCount(0);
        }).toPass({ timeout: 30_000 });
      }
    });
  }

  test("retired issue links reveal published and candidate-only watchlist check-ins", async ({ page }) => {
    await signInAsAdmin(page);

    try {
      await seedCandidateOnlyWatchlist(page);
      // Direct fixture setup does not touch Next's tagged reads. Saving the
      // existing settings through the admin action makes the app revalidate.
      await revalidatePublicIssues(page);
      // Public reads use stale-while-revalidate. Confirm the new topic has
      // reached the board before testing search against that fixture.
      await expect(async () => {
        await page.goto("/issues");
        await expect(page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).locator(".board-view-count")).toHaveText("1", { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });

      await page.setViewportSize({ width: 1440, height: 1100 });
      const publishedId = "00000000-0000-4000-8000-000000000002";
      await page.goto(`/report?issue=${publishedId}`);
      await waitForHydration(page);
      await expect(page).toHaveURL(new RegExp(`/issues#issue-${publishedId}$`));
      await expect(page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(`#issue-${publishedId}`)).toBeInViewport();

      await page.getByRole("searchbox", { name: "Find an issue" }).fill("candidate-only");
      await expect(page.getByRole("status")).toContainText("1 match across both views");
      await page.getByRole("button", { name: "View 1 matching watchlist topic", exact: true }).click();
      const watchlistView = page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ });
      await expect(watchlistView).toHaveAttribute("aria-pressed", "true");
      await expect(watchlistView).toBeFocused();
      await expect(page.getByRole("heading", { name: "Candidate-only watchlist check-in", exact: true })).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "Find an issue" })).toHaveValue("candidate-only");
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/report?issue=${CANDIDATE_ONLY_ID}`);
      await expect(page).toHaveURL(new RegExp(`/issues#issue-${CANDIDATE_ONLY_ID}$`));
      await expect(page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toBeInViewport();
    } finally {
      const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
      expect(reset.ok(), "fixture reset failed — later projects would inherit this test's writes").toBe(true);
      // Reset restores mock rows only. The same safe admin write invalidates
      // app caches before Chromium and mobile snapshot projects start.
      await revalidatePublicIssues(page);
      await expect(async () => {
        await page.goto("/issues");
        await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toHaveCount(0);
      }).toPass({ timeout: 30_000 });
    }
  });

  test("a watchlist check-in ends at its buttons, so the next topic follows", async ({ page }) => {
    await signInAsAdmin(page);
    try {
      await seedCandidateOnlyWatchlist(page);
      await seedCandidateOnlyWatchlist(page, SECOND_CANDIDATE_TOPIC);
      await revalidatePublicIssues(page);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(async () => {
          await page.goto("/issues");
          await waitForHydration(page);
          await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
          await expect(page.locator(`#issue-${SECOND_CANDIDATE_TOPIC.id}`)).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
        // Both topics sit in one category column. A flex basis left from the old
        // row layout once made the first check-in block 360px tall, which left an
        // empty band above the second topic.
        const layout = await page.locator(".watch-category").filter({ has: page.locator(`#issue-${CANDIDATE_ONLY_ID}`) }).evaluate((column) => {
          const [entry, next] = column.querySelectorAll<HTMLElement>(".watch-entry");
          const buttons = entry.querySelectorAll(".confirmation-checkin__row .tap-btn");
          const lastButton = buttons[buttons.length - 1].getBoundingClientRect();
          return {
            entries: column.querySelectorAll(".watch-entry").length,
            band: entry.querySelector(".confirmation-checkin")!.getBoundingClientRect().bottom - lastButton.bottom,
            gap: next.getBoundingClientRect().top - lastButton.bottom - Number.parseFloat(getComputedStyle(entry).paddingBottom),
          };
        });
        expect(layout.entries).toBe(2);
        expect(Math.abs(layout.band), `empty band under the check-in buttons at ${width}px`).toBeLessThan(1);
        expect(Math.abs(layout.gap), `space before the next topic beyond the entry padding at ${width}px`).toBeLessThan(1);
      }
    } finally {
      const reset = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`);
      expect(reset.ok()).toBe(true);
      await revalidatePublicIssues(page);
      await expect(async () => {
        await page.goto("/issues");
        await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toHaveCount(0);
      }).toPass({ timeout: 30_000 });
    }
  });
});
