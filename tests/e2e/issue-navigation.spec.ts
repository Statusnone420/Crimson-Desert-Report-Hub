import { expect, test, type Locator, type Page } from "@playwright/test";

import { refreshFixtureReads, signInAsAdmin, waitForHydration } from "./helpers";
import { installTurnstile } from "./checkin-helpers";

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
    test(`a thumb saves, switches and is taken back without a count or a board change at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await installTurnstile(page);
      await signInAsAdmin(page);
      try {
        await seedCandidateOnlyWatchlist(page);
        await revalidatePublicIssues(page);
        const openWatchlist = async () => {
          await expect(async () => {
            await page.goto("/issues");
            await waitForHydration(page);
            await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
            await expect(page.locator(`#issue-${CANDIDATE_ONLY_ID}`)).toBeVisible({ timeout: 1_000 });
          }).toPass({ timeout: 30_000 });
        };
        await openWatchlist();

        const card = page.locator(`#issue-${CANDIDATE_ONLY_ID}`);
        const up = card.getByRole("button", { name: "Happening to me", exact: true });
        const down = card.getByRole("button", { name: "Not happening for me", exact: true });
        const stored = async () => {
          const rows = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_thumbs?cluster_id=eq.${CANDIDATE_ONLY_ID}`);
          return ((await rows.json()) as { direction: string }[]).map((row) => row.direction);
        };
        const tap = async (button: Locator) => {
          const posted = page.waitForResponse((response) => response.url().endsWith("/api/thumbs") && response.request().method() === "POST");
          await button.click();
          expect((await posted).status()).toBe(200);
        };

        await tap(up);
        await expect(up).toHaveAttribute("aria-pressed", "true");
        expect(await stored()).toEqual(["up"]);
        await tap(down);
        await expect(down).toHaveAttribute("aria-pressed", "true");
        await expect(up).toHaveAttribute("aria-pressed", "false");
        expect(await stored()).toEqual(["down"]);
        await tap(down);
        await expect(down).toHaveAttribute("aria-pressed", "false");
        expect(await stored()).toEqual([]);
        await tap(up);
        expect(await stored()).toEqual(["up"]);
        await expect(card.locator(".tap-btn__count")).toHaveCount(0);

        // A thumb never moves a topic: a fresh render keeps it on the watchlist.
        await revalidatePublicIssues(page);
        await openWatchlist();
        await expect(card.getByRole("button", { name: "Happening to me", exact: true })).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ }).click();
        await expect(card).toHaveCount(0);

        // Neither the HTML nor the RSC payload carries thumb totals or network hashes.
        for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
          const board = await request.get("/issues", { headers });
          expect(board.status()).toBe(200);
          expect(await board.text()).not.toMatch(/rankScore|issue_thumbs|voter_ip_hash|"(?:up|down)":\s*\d/);
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
  }

  test("a topic published from player posts alone shows on the board with its label", async ({ page }) => {
    await signInAsAdmin(page);
    const topic = { id: "00000000-0000-4000-8000-000000000097", title: "Inventory freeze after patch 1.13.01" };
    try {
      const cluster = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_clusters`, {
        data: {
          id: topic.id, slug: "inventory-freeze-threads", title: topic.title, category: "controls_gameplay",
          description: "Opening the inventory freezes the game for a few seconds.", fix_status: "reported",
          confidence: "medium", is_public: true, admin_override: false,
        },
      });
      expect(cluster.ok(), "player-thread cluster fixture insert failed").toBe(true);
      for (const thread of ["701", "702", "703"]) {
        const signal = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/source_signals`, {
          data: {
            id: `thread-signal-${thread}`, cluster_id: topic.id, source: "web_search", source_type: "web_search",
            source_url: `https://steamcommunity.com/app/3321460/discussions/0/582810005140000${thread}/`,
            title: "Crimson Desert inventory freeze", summary: "Opening the inventory freezes Crimson Desert after patch 1.13.01.",
            source_published_at: "2026-07-19T12:00:00.000Z", public_status: "public", category: "controls_gameplay",
            confidence: "medium", observed_at: "2026-07-19T12:00:00.000Z",
          },
        });
        expect(signal.ok(), "player-thread signal fixture insert failed").toBe(true);
      }
      await revalidatePublicIssues(page);
      const card = page.locator(`#issue-${topic.id}`);
      await expect(async () => {
        await page.goto("/issues");
        await waitForHydration(page);
        await expect(card).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });

      await expect(page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ })).toHaveAttribute("aria-pressed", "true");
      await expect(card.getByRole("heading", { name: topic.title, exact: true })).toBeVisible();
      await expect(card.getByText("Seen in 3 player posts. Not confirmed by Pearl Abyss.", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Happening to me", exact: true })).toBeVisible();
      await expect(card.locator(".dispatch-byline")).toHaveText("Patch 1.13.01");
    } finally {
      expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`)).ok()).toBe(true);
      await revalidatePublicIssues(page);
      await expect(async () => {
        await page.goto("/issues");
        await expect(page.locator(`#issue-${topic.id}`)).toHaveCount(0);
      }).toPass({ timeout: 30_000 });
    }
  });

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

  test("a watchlist thumb control ends at its buttons, so the next topic follows", async ({ page }) => {
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
        // Both topics sit in one category column. A flex basis left from an old
        // row layout once made the first block 360px tall, which left an empty
        // band above the second topic.
        const layout = await page.locator(".watch-category").filter({ has: page.locator(`#issue-${CANDIDATE_ONLY_ID}`) }).evaluate((column) => {
          const [entry, next] = column.querySelectorAll<HTMLElement>(".watch-entry");
          const buttons = entry.querySelectorAll(".issue-thumbs__button");
          const lastButton = buttons[buttons.length - 1].getBoundingClientRect();
          return {
            entries: column.querySelectorAll(".watch-entry").length,
            band: entry.querySelector(".issue-thumbs")!.getBoundingClientRect().bottom - lastButton.bottom,
            gap: next.getBoundingClientRect().top - lastButton.bottom - Number.parseFloat(getComputedStyle(entry).paddingBottom),
          };
        });
        expect(layout.entries).toBe(2);
        expect(Math.abs(layout.band), `empty band under the thumbs at ${width}px`).toBeLessThan(1);
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

  test("each watchlist topic shows its own image, the same one on every visit", async ({ page }) => {
    await signInAsAdmin(page);
    try {
      await seedCandidateOnlyWatchlist(page);
      await seedCandidateOnlyWatchlist(page, SECOND_CANDIDATE_TOPIC);
      await revalidatePublicIssues(page);
      const column = page.locator(".watch-category").filter({ has: page.locator(`#issue-${CANDIDATE_ONLY_ID}`) });
      const shownImages = async () => {
        await expect(async () => {
          await page.goto("/issues");
          await waitForHydration(page);
          await page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Watchlist/ }).click();
          await expect(page.locator(`#issue-${SECOND_CANDIDATE_TOPIC.id}`)).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
        // The column no longer has an image of its own; each topic carries one.
        await expect(column.locator(":scope > figure")).toHaveCount(0);
        const entries = column.locator(".watch-entry");
        await expect(entries).toHaveCount(2);
        for (const entry of await entries.all()) {
          await expect(entry.locator("figure img")).toHaveCount(1);
          await expect(entry.locator("figure img")).toHaveAttribute("alt", "");
          await expect(entry.locator("figcaption")).toHaveText("Image: Pearl Abyss");
        }
        return entries.locator("figure img").evaluateAll((images) => images.map((image) => new URL(image.getAttribute("src")!, location.href).searchParams.get("url")));
      };
      const first = await shownImages();
      expect(first.every((source) => source?.startsWith("/official/"))).toBe(true);
      expect(new Set(first).size).toBe(2);
      expect(await shownImages()).toEqual(first);
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
