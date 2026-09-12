import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

const MOCK_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const PAIRING_ID = "00000000-0000-4000-8000-000000000201";

test.afterEach(async ({ page }) => {
  expect((await page.request.post(`${MOCK_ORIGIN}/__test__/reset`)).ok()).toBe(true);
});

test("public exact claim context stays unavailable before the first durable sync", async ({ page }) => {
  expect((await page.request.post(`${MOCK_ORIGIN}/__test__/claim-review-awaiting-sync`)).ok()).toBe(true);
  const marker = await page.request.get(`${MOCK_ORIGIN}/rest/v1/claim_review_sync_state`);
  expect(marker.ok()).toBe(true);
  expect(await marker.json()).toEqual([]);

  await page.goto("/issues");
  const issue = page.getByRole("article", { name: "Map-open crash persists after fix", exact: true });
  await expect(issue).toBeVisible();
  const context = issue.getByRole("region", { name: "Official fix being checked", exact: true });
  await expect(context).toContainText("The exact official claim could not be read.");
  await expect(context).not.toContainText("No confirmed official claim is attached");
  await expect(context.getByRole("link", { name: "Review the official fix record →" })).toHaveAttribute("href", "/patches#claims");
});

test("claim decisions reject stale lifecycle state and recover after explicit reload", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/operator?view=claims&item=${PAIRING_ID}`);
  const pairingRead = await page.request.get(`${MOCK_ORIGIN}/rest/v1/claim_review_pairings?id=eq.${PAIRING_ID}`);
  expect(pairingRead.ok()).toBe(true);
  const pairing = (await pairingRead.json()).find((row: { id: string }) => row.id === PAIRING_ID);
  for (const patch of [
    { admin_override: true, fix_status: "verified_fixed", lifecycle_reason: "Manually verified." },
    { admin_override: false, fix_claimed_at: null, fix_claimed_patch_version: null, lifecycle_reason: null },
  ]) {
    const result = await page.request.patch(`${MOCK_ORIGIN}/rest/v1/issue_clusters?id=eq.${pairing.cluster_id}`, { data: patch });
    expect(result.ok()).toBe(true);
  }
  await page.getByRole("button", { name: "Confirm match", exact: true }).click();
  await expect(page.getByText("Nothing was changed by this attempt.", { exact: false })).toBeVisible();
  const unchanged = await page.request.get(`${MOCK_ORIGIN}/rest/v1/issue_clusters?id=eq.${pairing.cluster_id}`);
  expect(unchanged.ok()).toBe(true);
  expect((await unchanged.json()).find((row: { id: string }) => row.id === pairing.cluster_id)).toMatchObject({ fix_status: "verified_fixed" });
  await page.getByRole("button", { name: "Reload current records" }).click();
  await page.getByRole("button", { name: "Confirm match", exact: true }).click();
  await expect(page.getByText("Decision saved. You can undo it in Decision history.")).toBeVisible();
  await page.getByRole("button", { name: "Undo decision" }).click();
  await expect(page.getByText("Decision undone. This match is waiting for review again.")).toBeVisible();
});

test("a confirmed match exposes only its exact public claim and opens the matching patch line", async ({ page }, testInfo) => {
  await signInAsAdmin(page);
  const pairingResponse = await page.request.get(`${MOCK_ORIGIN}/rest/v1/claim_review_pairings?id=eq.${PAIRING_ID}`);
  expect(pairingResponse.ok()).toBe(true);
  const pairing = (await pairingResponse.json()).find((row: { id: string }) => row.id === PAIRING_ID);
  await page.goto(`/operator?view=claims&item=${PAIRING_ID}`);
  await page.getByRole("button", { name: "Confirm match", exact: true }).click();
  await expect(page.getByText("Decision saved. You can undo it in Decision history.")).toBeVisible();

  try {
    await expect(async () => {
      await page.goto("/issues");
      await expect(page.getByRole("region", { name: "Official fix being checked", exact: true })).toContainText(pairing.exact_official_text);
    }).toPass({ timeout: 30_000 });
    const context = page.getByRole("region", { name: "Official fix being checked", exact: true });
    await expect(context.getByRole("link", { name: "Pearl Abyss source ↗", exact: true })).toHaveAttribute("href", pairing.official_url);
    await expect(context.getByRole("link", { name: "Find this fix in the patch record →", exact: true })).toHaveAttribute("href", `/patches#claim-${pairing.claim_key}`);
    const publicHtml = await (await page.request.get("/issues")).text();
    expect(publicHtml).not.toContain(PAIRING_ID);
    expect(publicHtml).not.toContain(pairing.proposal_reason);
    await context.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("confirmed-claim.png"), animations: "disabled" });
    await context.getByRole("link", { name: "Find this fix in the patch record →", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#claim-${pairing.claim_key}$`));
    await expect(page.locator(`#claim-${pairing.claim_key}`)).toHaveText(pairing.exact_official_text);
    await expect(page.locator(`#claim-${pairing.claim_key}`)).toBeInViewport();
  } finally {
    await page.goto(`/operator?view=claims&item=${PAIRING_ID}`);
    await page.getByRole("button", { name: "Undo decision" }).click();
    await expect(page.getByText("Decision undone. This match is waiting for review again.")).toBeVisible();
  }
});
