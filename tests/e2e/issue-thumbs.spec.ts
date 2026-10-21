import { expect, test, type Locator, type Page } from "@playwright/test";
import { installTurnstile } from "./checkin-helpers";
import { waitForHydration } from "./helpers";

const FPS_ID = "00000000-0000-4000-8000-000000000001";

async function fpsCard(page: Page) {
  await page.goto("/issues");
  await waitForHydration(page);
  const card = page.locator(`#issue-${FPS_ID}`);
  await expect(card).toBeVisible();
  return card;
}

function thumbs(card: Locator) {
  return {
    block: card.locator(".issue-thumbs"),
    group: card.getByRole("group", { name: "Happening to you on 1.13.01?" }),
    up: card.getByRole("button", { name: "Happening to me", exact: true }),
    down: card.getByRole("button", { name: "Not happening for me", exact: true }),
  };
}

/** Answers every thumb write and keeps each request body. */
async function recordThumbWrites(page: Page, reply: { status: number; body: unknown } = { status: 200, body: null }) {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/thumbs", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(body);
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body ?? { ok: true, direction: body.direction, patch_version: "1.13.01" }),
    });
  });
  return writes;
}

async function expectNoCount(block: Locator) {
  await expect(block.locator(".tap-btn__count")).toHaveCount(0);
  expect((await block.innerText()).replaceAll("1.13.01", "")).not.toMatch(/\d/);
}

test("an issue without a fix claim gets a compact thumb control with no count", async ({ page }) => {
  const card = await fpsCard(page);
  const { block, group, up, down } = thumbs(card);

  await expect(group).toBeVisible();
  for (const button of [up, down]) {
    await expect(button).toHaveAttribute("aria-pressed", "false");
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  // The old full-width panel and its counted buttons are gone.
  await expect(card.locator(".confirmation-checkin")).toHaveCount(0);
  // Thumbs keep no tally, so the earlier check-in count stays off this card.
  await expect(card.locator(".checkin-history")).toHaveCount(0);
  await expectNoCount(block);
});

test("a tap saves after the bot check, can switch, and can be taken back", async ({ page }) => {
  await installTurnstile(page);
  const writes = await recordThumbWrites(page);
  const card = await fpsCard(page);
  const { block, up, down } = thumbs(card);

  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(down).toHaveAttribute("aria-pressed", "false");
  await expect(block.getByRole("status")).toHaveText("Saved on this device. Tap again to undo.");
  expect(writes).toEqual([{ cluster_id: FPS_ID, patch_version: "1.13.01", direction: "up", turnstile_token: expect.stringMatching(/^stub-token-/) }]);
  // Only the person who tapped sees the green thumb: it is inked, the other stays an outline.
  await expect(up.locator(".issue-thumbs__ink")).toHaveCSS("opacity", "1");
  await expect(down.locator(".issue-thumbs__ink")).toHaveCSS("opacity", "0");
  await page.mouse.move(0, 0);
  expect(await up.evaluate((button) => getComputedStyle(button).color)).not.toBe(
    await down.evaluate((button) => getComputedStyle(button).color),
  );

  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "true");
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "false");
  await expect(block.getByRole("status")).toHaveText("Undone.");
  expect(writes.map((write) => write.direction)).toEqual(["up", "down", "none"]);
  // Each tap used its own bot check token.
  expect(new Set(writes.map((write) => write.turnstile_token)).size).toBe(3);
  await expectNoCount(block);
});

test("the choice stays on this device after a reload", async ({ page }) => {
  await installTurnstile(page);
  await recordThumbWrites(page);
  const card = await fpsCard(page);
  await thumbs(card).up.click();
  await expect(thumbs(card).up).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await waitForHydration(page);
  await expect(thumbs(page.locator(`#issue-${FPS_ID}`)).up).toHaveAttribute("aria-pressed", "true");
});

test("an earlier check-in on this device shows as its thumb", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "not_happening"), `cd-checkin-${FPS_ID}-1.13.01`);
  const card = await fpsCard(page);
  await expect(thumbs(card).down).toHaveAttribute("aria-pressed", "true");
  await expect(thumbs(card).up).toHaveAttribute("aria-pressed", "false");
});

test("a refused tap says why and leaves the thumb unlit", async ({ page }) => {
  await installTurnstile(page);
  await recordThumbWrites(page, { status: 429, body: { error: "rate_limited" } });
  const card = await fpsCard(page);
  const { block, up } = thumbs(card);

  await up.click();
  await expect(block.getByRole("alert")).toHaveText("Too many taps from this network. Try again later.");
  await expect(up).toHaveAttribute("aria-pressed", "false");
});

test("the thumb control fits a phone screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The phone baseline is drawn at 390px.");
  await installTurnstile(page);
  await recordThumbWrites(page);
  const card = await fpsCard(page);
  const { block, up, down } = thumbs(card);
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");

  const cardBox = await card.boundingBox();
  const [upBox, downBox, blockBox] = await Promise.all([up.boundingBox(), down.boundingBox(), block.boundingBox()]);
  // Both thumbs sit side by side inside the card, with no sideways scroll.
  expect(Math.abs(upBox!.y - downBox!.y)).toBeLessThan(1);
  expect(blockBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  expect(blockBox!.x + blockBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(block).toHaveScreenshot("issue-thumbs.png");
});
