import { expect, test, type Page } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const CANDIDATE_ONLY_ID = "00000000-0000-4000-8000-000000000099";

async function submitAction(page: Page, submit: () => Promise<void>) {
  const posted = page.waitForResponse(async (response) => {
    const request = response.request();
    return request.method() === "POST" && Boolean((await request.allHeaders())["next-action"]);
  });
  await submit();
  expect((await posted).status(), "server action returned an error status").toBeLessThan(400);
}

async function revalidatePublicIssues(page: Page) {
  await page.goto("/operator?view=scanner");
  const settings = page.locator("details.operator-disclosure").filter({ has: page.getByLabel("AI model", { exact: true }) });
  await settings.locator(":scope > summary").click();
  await submitAction(page, () => settings.getByRole("button", { name: "Save settings" }).click());
  await expect(settings.getByRole("button", { name: "Save settings" })).toBeEnabled();
}

async function seedCandidateOnlyWatchlist(page: Page) {
  const cluster = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/issue_clusters`, {
    data: {
      id: CANDIDATE_ONLY_ID,
      slug: "candidate-only-watchlist",
      title: "Candidate-only watchlist check-in",
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
      id: "candidate-only-signal",
      cluster_id: CANDIDATE_ONLY_ID,
      source: "web_search",
      source_type: "web_search",
      source_url: "https://community.example/crimson-desert/candidate-only-watchlist",
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

  test("retired issue links reveal published and candidate-only watchlist check-ins", async ({ page }) => {
    await signInAsAdmin(page);

    try {
      await seedCandidateOnlyWatchlist(page);
      // Direct fixture setup does not touch Next's tagged reads. Saving the
      // existing settings through the admin action makes the app revalidate.
      await revalidatePublicIssues(page);

      await page.setViewportSize({ width: 1440, height: 1100 });
      const publishedId = "00000000-0000-4000-8000-000000000002";
      await page.goto(`/report?issue=${publishedId}`);
      await expect(page).toHaveURL(new RegExp(`/issues#issue-${publishedId}$`));
      await expect(page.getByRole("group", { name: "Choose board view" }).getByRole("button", { name: /Published issues/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(`#issue-${publishedId}`)).toBeInViewport();

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
});
