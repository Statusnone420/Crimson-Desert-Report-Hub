import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const CANDIDATE_ID = "video-pending-1";

async function archiveFixture(page: Parameters<typeof signInAsAdmin>[0]) {
  const response = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_video_review_candidate`, {
    data: { p_id: "video-draft-1", p_revision: 2, p_operation: "archive", p_candidate: null, p_draft: null },
  });
  expect(response.ok()).toBe(true);
  await signInAsAdmin(page);
  await page.goto("/admin/videos?item=video-draft-1");
}

for (const failure of ["database", "stale", "transport"] as const) {
  test(`failed video restore stays visible after ${failure} failure`, async ({ page }) => {
    await archiveFixture(page);
    if (failure === "database") {
      expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/fail-next-video-mutation`)).ok()).toBe(true);
    } else if (failure === "stale") {
      for (const [revision, operation] of [[3, "restore"], [4, "archive"]] as const) {
        expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_video_review_candidate`, {
          data: { p_id: "video-draft-1", p_revision: revision, p_operation: operation, p_candidate: null, p_draft: null },
        })).ok()).toBe(true);
      }
    } else {
      await page.route("**/*", async (route) => {
        if (route.request().method() === "POST" && (await route.request().allHeaders())["next-action"]) {
          await route.abort("failed");
        } else await route.continue();
      });
    }
    await page.getByRole("button", { name: "Restore draft", exact: true }).click();
    const message = failure === "database"
      ? "The private inbox could not save that change. Your entered details are still here; try again."
      : failure === "stale"
        ? "This candidate changed elsewhere. Your entered details are still here; reload before trying again."
        : "Save not confirmed; connection failed; request may have completed, reload current records before retrying.";
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole("tab", { name: /Archived drafts/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Restore draft", exact: true })).toBeEnabled();
  });
}

test("successful video restore opens the active candidate", async ({ page }) => {
  await archiveFixture(page);
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^Active/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Video details: Fixture draft-ready commentary" })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`)).ok()).toBe(true);
});

test("video draft keeps its original revision after an unrelated queue refresh", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/videos?item=${CANDIDATE_ID}`);
  const editor = page.getByRole("region", { name: /^Video details:/ });
  await editor.getByLabel("Title").fill("Unsaved local title from revision one");

  const read = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/video_review_candidates?id=eq.${CANDIDATE_ID}`);
  expect(read.ok()).toBe(true);
  const candidate = (await read.json()).find((row: { id: string }) => row.id === CANDIDATE_ID);
  const changed = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_video_review_candidate`, {
    data: {
      p_id: CANDIDATE_ID, p_revision: candidate.revision, p_operation: "save",
      p_candidate: { ...candidate, review_note: "New review note saved by another operator" }, p_draft: null,
    },
  });
  expect(changed.ok()).toBe(true);

  // A successful action on a different candidate refreshes every queue row.
  const other = page.locator("article").filter({ hasText: "Fixture draft-ready commentary" });
  await other.getByRole("button", { name: "Archive draft" }).click();
  await expect(other).toHaveCount(0);
  await page.getByRole("button", { name: /Fixture expansion commentary for inbox tests/ }).click();
  await expect(editor.getByLabel("Title")).toHaveValue("Unsaved local title from revision one");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("This candidate changed elsewhere. Your entered details are still here; reload before trying again.")).toBeVisible();

  const stored = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/video_review_candidates?id=eq.${CANDIDATE_ID}`);
  expect(stored.ok()).toBe(true);
  expect((await stored.json()).find((row: { id: string }) => row.id === CANDIDATE_ID)).toMatchObject({
    revision: 2,
    title: candidate.title,
    review_note: "New review note saved by another operator",
  });
});

test("video draft advances its revision only after its own confirmed save", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/videos?item=${CANDIDATE_ID}`);
  const editor = page.getByRole("region", { name: /^Video details:/ });
  await editor.getByLabel("Title").fill("First confirmed title");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("Saved private video review.")).toBeVisible();
  await editor.getByLabel("Title").fill("Second confirmed title");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => {
    const stored = await page.request.get(`${MOCK_SUPABASE_ORIGIN}/rest/v1/video_review_candidates?id=eq.${CANDIDATE_ID}`);
    return (await stored.json()).find((row: { id: string }) => row.id === CANDIDATE_ID);
  }).toMatchObject({ revision: 3, title: "Second confirmed title" });
});
