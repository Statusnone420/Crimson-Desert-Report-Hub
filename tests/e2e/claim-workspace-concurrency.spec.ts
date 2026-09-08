import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

const MOCK_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const PAIRING_ID = "00000000-0000-4000-8000-000000000201";

test.afterEach(async ({ page }) => {
  expect((await page.request.post(`${MOCK_ORIGIN}/__test__/reset`)).ok()).toBe(true);
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
