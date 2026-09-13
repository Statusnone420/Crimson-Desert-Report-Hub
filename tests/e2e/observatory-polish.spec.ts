import { expect, test } from "@playwright/test";

test("scrolling under a stationary pointer preserves the selected review reading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chromium", "Hover is a desktop interaction.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/observatory");
  const selectedDate = page.locator(".obs-chart-readout p > span").first();
  const latest = await selectedDate.innerText();
  const firstBar = page.locator(".obs-review-hit").first();
  const box = await firstBar.boundingBox();
  const centerY = page.viewportSize()!.height / 2;
  const centerX = box!.x + box!.width / 2;
  await page.mouse.move(centerX, centerY);
  await expect(selectedDate).toHaveText(latest);
  await firstBar.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  // Scrolling can synthesize pointer-enter without the reader moving the mouse.
  await expect(firstBar).toBeInViewport();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(selectedDate).toHaveText(latest);
  await page.mouse.move(centerX + 1, centerY);
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");
});

test("recorded Twitch history stays usable with an explicit capture timestamp", async ({ page }, testInfo) => {
  await page.goto("/observatory#platform-activity");
  const activity = page.locator("#platform-activity");
  const olderHistory = process.env.PREVIEW_SEED_FILE?.endsWith("platform-context-older-history.json");
  const range = activity.getByRole("group", { name: "Twitch window" });
  await expect(range).toBeVisible();
  if (olderHistory) {
    await expect(range.getByRole("button", { name: "24 hours", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(activity.locator(".obs-twitch-chart")).toHaveCount(0);
    await expect(activity.getByText("No complete Twitch captures are available in this 24-hour window.", { exact: true })).toBeVisible();
    await expect(activity.locator(".obs-note").first()).toContainText("The latest Twitch capture is incomplete. Historical captures are not live.");
    await activity.screenshot({ path: testInfo.outputPath("twitch-empty-window.png") });
  } else {
    await expect(activity.getByRole("img", { name: /^24-hour Twitch viewers history/ })).toBeVisible();
  }
  await expect(activity.locator(".obs-note").first()).toContainText(/Latest complete capture: .+ UTC\./);
  if (process.env.PREVIEW_SEED_FILE?.endsWith("platform-context-delayed.json")) {
    await expect(activity.locator(".obs-note").first()).toContainText("Latest Twitch capture is delayed. Historical captures are not live.");
  }
  await expect(activity.locator(".obs-audience .np-error")).toHaveCount(0);
  await range.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(activity.getByRole("img", { name: /^Seven-day Twitch viewers history/ })).toBeVisible();
  if (olderHistory) {
    await expect(activity.getByRole("img", { name: /^Seven-day Twitch viewers history/ })).toHaveAccessibleName(/2 recorded captures/);
    await expect(range.getByRole("button", { name: "7 days", exact: true })).toBeFocused();
    await range.getByRole("button", { name: "24 hours", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(activity.locator(".obs-twitch-chart")).toHaveCount(0);
    await expect(range).toBeVisible();
    await expect(range.getByRole("button", { name: "24 hours", exact: true })).toBeFocused();
    await range.getByRole("button", { name: "7 days", exact: true }).click();
  }
  await activity.getByRole("group", { name: "Twitch metric" }).getByRole("button", { name: "Streams", exact: true }).click();
  await expect(activity.getByRole("img", { name: /^Seven-day Twitch streams history/ })).toBeVisible();
  await activity.getByText("Read the Twitch captures", { exact: true }).click();
  expect(await activity.locator(".obs-twitch-values tbody tr").count()).toBeGreaterThan(1);
  if (olderHistory) {
    await expect(activity.locator(".obs-twitch-values tbody tr")).toHaveCount(2);
    await expect(activity.locator(".obs-twitch-values tbody tr").first()).toContainText("321");
    await expect(activity.locator(".obs-twitch-values tbody tr").last()).toContainText("87");
    await expect(activity.locator(".obs-twitch-values tbody")).not.toContainText("9,999");
  }
  await activity.screenshot({ path: testInfo.outputPath("twitch-history.png") });
});

test("review movement offers full-size reading controls without reducing the data", async ({ page }) => {
  await page.goto("/observatory#review-record");

  const movementMode = page.getByRole("group", { name: "Review chart" }).getByRole("button", { name: "Review movement", exact: true });
  const shareMode = page.getByRole("group", { name: "Review chart" }).getByRole("button", { name: "Positive share", exact: true });
  const previous = page.getByRole("button", { name: "Previous review reading" });
  const next = page.getByRole("button", { name: "Next review reading" });
  const readout = page.locator(".obs-chart-readout").first();
  const selectedDate = readout.locator("p > span");
  const tableRows = page.locator("#review-record .obs-data-table tbody tr");

  await expect(movementMode).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Review readings" }).getByRole("button", { name: "14 readings", exact: true })).toHaveAttribute("aria-pressed", "true");
  const availableReadings = await tableRows.count();
  expect(availableReadings).toBeGreaterThan(1);
  const readingDates = await tableRows.locator("th").allTextContents();
  await expect(selectedDate).toHaveText(readingDates.at(-1)!);

  const latestReadout = await readout.innerText();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await previous.focus();
  await expect(previous).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(readout).not.toHaveText(latestReadout, { useInnerText: true });
  await expect(selectedDate).toHaveText(readingDates.at(-2)!);

  for (let index = availableReadings - 3; index >= 0; index -= 1) {
    await previous.click();
    await expect(selectedDate).toHaveText(readingDates[index]);
  }
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  const earliestReadout = await readout.innerText();
  await next.click();
  await expect(readout).not.toHaveText(earliestReadout, { useInnerText: true });

  await shareMode.click();
  await expect(shareMode).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".obs-share-days > span")).toContainText("balance");
  await movementMode.click();
  await expect(movementMode).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".obs-share-days > span")).toContainText("movement");
  await expect(page.getByRole("button", { name: "Next review reading" })).toBeDisabled();

  await expect(page.getByRole("link", { name: /approved player reports? in this patch family/ })).toHaveAttribute("href", "/issues");
});
