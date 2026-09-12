import { expect, test } from "@playwright/test";

async function checkInCard(page: import("@playwright/test").Page) {
  await page.goto("/issues");
  const card = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
  await expect(card).toHaveCount(1);
  return card;
}

test("check-in choices keep visible borders and 44px targets", async ({ page }) => {
  const card = await checkInCard(page);
  const choices = card.locator(".confirmation-checkin__row .tap-btn");

  await expect(choices).not.toHaveCount(0);
  for (const choice of await choices.all()) {
    expect(await choice.evaluate((button) => Number.parseFloat(getComputedStyle(button).borderTopWidth))).toBeGreaterThanOrEqual(1);
    expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("check-in picker focuses the platform and cancel or Escape does not post", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => {
    posts += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /Fixed for me/ });
  const platform = card.getByRole("button", { name: "PC (Steam)", exact: true });

  await choice.click();
  await expect(platform).toBeFocused();
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(choice).toBeFocused();
  expect(posts).toBe(0);

  await choice.focus();
  await page.keyboard.press("Enter");
  await expect(platform).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(choice).toBeFocused();
  await expect(platform).toHaveCount(0);
  expect(posts).toBe(0);
});

test("check-in posts once, disables its full picker while pending, and does not invent a count", async ({ page }) => {
  let posts = 0;
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/confirmations", async (route) => {
    posts += 1;
    await heldResponse;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /Fixed for me/ });
  const count = choice.locator(".tap-btn__count");
  const before = await count.textContent();

  await choice.click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
  for (const button of await card.locator(".confirmation-checkin button").all()) await expect(button).toBeDisabled();
  expect(posts).toBe(1);

  release();
  await expect(card.getByText("Recorded once per network per patch. Counts refresh from the server; you can change your answer.")).toBeVisible();
  await expect(count).toHaveText(before ?? "");
  expect(posts).toBe(1);
});

test("preview refusal keeps the selected platform flow available for retry", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => {
    posts += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "preview_writes_disabled" }),
    });
  });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /Fixed for me/ });

  await choice.click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  await expect(card.getByText("This preview is read-only. Confirmations work on the production site.")).toBeVisible();
  await expect(card.getByRole("button", { name: "PC (Steam)", exact: true })).toBeEnabled();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  expect(posts).toBe(1);
});

test("an in-flight check-in cannot update a remounted board flow", async ({ page }) => {
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/confirmations", async (route) => {
    await heldResponse;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const card = await checkInCard(page);
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/confirmations") && candidate.request().method() === "POST",
  );
  await card.getByRole("button", { name: /Fixed for me/ }).click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();

  const boardViews = page.getByRole("group", { name: "Choose board view" });
  await boardViews.getByRole("button", { name: /Watchlist/ }).click();
  await expect(card).toHaveCount(0);
  release();
  await response;

  await boardViews.getByRole("button", { name: /Published issues/ }).click();
  const replacement = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
  await expect(replacement).toHaveCount(1);
  await expect(replacement.getByText("Recorded once per network per patch. Counts refresh from the server; you can change your answer.")).toHaveCount(0);
  await expect(replacement.getByText("Recording your answer…", { exact: true })).toHaveCount(0);
  await expect(replacement.getByRole("button", { name: /Fixed for me/ })).toHaveAttribute("aria-pressed", "false");
});
