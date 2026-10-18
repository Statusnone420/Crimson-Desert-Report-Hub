import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test("scrolling under a stationary pointer preserves the selected review reading", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chromium", "Hover is a desktop interaction.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/observatory");
  await waitForHydration(page);
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
  await waitForHydration(page);
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

test("a Twitch collection gap reports itself on hover and leaves its end captures selectable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chromium", "Hover is a desktop interaction.");
  await page.goto("/observatory#platform-activity");
  await waitForHydration(page);
  const activity = page.locator("#platform-activity");
  const readout = activity.locator(".obs-twitch-readout");
  const chart = activity.locator(".obs-twitch-chart");
  await chart.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  // The gap nearest the latest capture, where the plot's side margins matter most.
  const gap = chart.locator(".obs-timeline-gap").last();
  await expect(gap).toBeInViewport();
  const box = (await gap.boundingBox())!;
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + box.width / 2, y);
  await expect(readout).toContainText(/No capture\s+between .+ and .+ UTC/);
  await expect(gap).toHaveClass(/is-active/);
  for (const endX of [box.x + 1, box.x + box.width - 1]) {
    await page.mouse.move(endX, y);
    await expect(readout).not.toContainText("No capture");
    await expect(readout).toContainText(/viewers/);
  }
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.move(0, 0);
  await expect(readout).not.toContainText("No capture");
});

test("review movement offers full-size reading controls without reducing the data", async ({ page }) => {
  await page.goto("/observatory#review-record");
  await waitForHydration(page);

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

test("review exploration connects the slider, positive-share line, and recorded table", async ({ page }) => {
  await page.goto("/observatory#review-record");
  await waitForHydration(page);
  const record = page.locator("#review-record");
  const slider = record.getByRole("slider", { name: "Choose a review reading" });
  const latest = await record.locator(".obs-chart-readout p > span").innerText();
  await slider.focus();
  await slider.press("Home");
  await expect(record.locator(".obs-chart-readout p > span")).not.toHaveText(latest);
  await expect(record.locator(".obs-review-hit").first()).toHaveAttribute("aria-pressed", "true");
  await slider.press("End");
  await expect(record.locator(".obs-chart-readout p > span")).toHaveText(latest);
  await record.getByRole("button", { name: "Positive share", exact: true }).click();
  await expect(record.getByRole("img", { name: /^Positive share across/ })).toBeVisible();
  await slider.focus();
  await slider.press("Home");
  await expect(record.locator(".obs-share-hit").first()).toHaveAttribute("aria-pressed", "true");
  await record.getByText("Read the chart values", { exact: true }).click();
  const firstRow = record.locator("tbody tr").first();
  await expect(record.locator(".obs-chart-readout p > span")).toHaveText(await firstRow.locator("th").innerText());
  await expect(record.locator(".obs-chart-readout strong")).toContainText(await firstRow.locator("td").last().innerText());
});

test("weekly scan exploration preserves the radar and connects daily outcomes to its table", async ({ page }) => {
  await page.goto("/observatory#scanner-radar");
  await waitForHydration(page);
  await expect(page.getByRole("img", { name: /^Tracked leads by category/ })).toBeVisible();
  await page.getByRole("button", { name: "New this week", exact: true }).click();
  await expect(page.getByRole("img", { name: /^New leads this week by category/ })).toBeVisible();
  const scan = page.getByRole("region", { name: "The weekly scan", exact: true });
  await expect(scan.locator(".obs-scan-outcomes")).toContainText("Not retained");
  const slider = scan.getByRole("slider", { name: "Choose a scan day" });
  await slider.focus();
  await slider.press("Home");
  await expect(scan.locator(".obs-scan-hit").first()).toHaveAttribute("aria-pressed", "true");
  await scan.getByRole("group", { name: "Scan outcomes" }).getByRole("button", { name: "Seen again", exact: true }).click();
  await expect(scan.locator(".obs-scan-stack .obs-flow-kept")).toHaveCount(0);
  await scan.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(scan.locator(".obs-scan-hit").count()).resolves.toBeGreaterThan(7);
  await slider.focus();
  await slider.press("End");
  await scan.getByText("Read the scan values", { exact: true }).click();
  const lastRow = scan.locator("tbody tr").last();
  await expect(scan.locator(".obs-chart-readout p > span")).toContainText(await lastRow.locator("th").innerText());
  await expect(scan.locator(".obs-chart-readout strong")).toContainText(await lastRow.locator("td").last().innerText());
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("platform record retains its source and date through a missing latest lookup", async ({ page }) => {
  await page.goto("/observatory#platform-activity");
  const platforms = page.locator(".obs-platforms");
  await expect(platforms.getByRole("heading", { name: "Where the game is listed" })).toBeVisible();
  await expect(platforms.getByRole("list")).toContainText("PlayStation 5");
  await expect(platforms.getByRole("link", { name: /View on IGDB/ })).toHaveAttribute("href", "https://www.igdb.com/games/crimson-desert");
  await expect(platforms.locator(".obs-platform-date")).toContainText("Last listed");
  if (process.env.PREVIEW_SEED_FILE?.endsWith("observatory-recovery.json")) {
    await expect(platforms.locator(".obs-platform-date")).toContainText("The latest check did not refresh this list");
    await expect(platforms.locator(".obs-platform-date")).toContainText("Jul 18");
    await expect(page.locator(".obs-audience-numbers")).toContainText("219");
  }
});

test("Steam player captures can be explored without changing the Twitch controls", async ({ page }) => {
  await page.goto("/observatory#platform-activity");
  await waitForHydration(page);
  const players = page.getByRole("region", { name: "Playing on Steam", exact: true });
  await expect(players.getByRole("img", { name: /^Steam player history/ })).toBeVisible();
  const slider = players.getByRole("slider", { name: "Choose a Steam player capture" });
  await slider.focus();
  await slider.press("Home");
  const first = await players.locator(".obs-player-readout").innerText();
  await slider.press("End");
  await expect(players.locator(".obs-player-readout")).not.toHaveText(first, { useInnerText: true });
  await players.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(players.getByRole("img", { name: /seven-day window/ })).toBeVisible();
  await players.getByText("Read the Steam player captures", { exact: true }).click();
  expect(await players.locator("tbody tr").count()).toBeGreaterThan(12);
  await expect(players).toContainText("excludes offline play and other platforms");
  await expect(page.getByRole("group", { name: "Twitch window" }).getByRole("button", { name: "24 hours", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("chart captions stay above their charts and the section bar stays short on a phone", async ({ page }, testInfo) => {
  await page.goto("/observatory");
  // The paper's figcaption is an image overlay; a chart caption must stay in the flow.
  const positions = await page.locator(".dd-figcaption").evaluateAll((captions) => captions.map((caption) => getComputedStyle(caption).position));
  expect(positions.length).toBeGreaterThan(0);
  expect(positions.filter((position) => position !== "static")).toEqual([]);
  const timeline = page.locator("#updates .dd-timeline");
  const caption = await timeline.locator(".dd-figcaption").boundingBox();
  const readout = await timeline.locator(".dd-measure:not([hidden]) .dd-readout").boundingBox();
  expect(caption!.y + caption!.height).toBeLessThanOrEqual(readout!.y);
  if (testInfo.project.name !== "mobile-chromium") return;
  const bar = page.getByRole("navigation", { name: "Observatory sections" });
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(120);
  await page.locator("#scanner-radar").evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  const current = bar.locator('a[aria-current="location"]');
  await expect(current).toHaveAttribute("href", "#scanner-radar");
  await expect(current).toBeInViewport();
});

test("the day-by-day chart shows one measure at a time and keeps each one's day", async ({ page }) => {
  await page.goto("/observatory#updates");
  await waitForHydration(page);
  const measures = page.getByRole("group", { name: "Measure" });
  const reviews = page.locator("#timeline-reviews");
  const twitch = page.locator("#timeline-twitch");
  await expect(measures.getByRole("button", { name: "New reviews a day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(reviews).toBeVisible();
  await expect(twitch).toBeHidden();
  const slider = reviews.getByRole("slider", { name: "Choose a day: new Steam reviews" });
  await slider.focus();
  await slider.press("Home");
  const first = await reviews.locator(".dd-readout").innerText();
  await measures.getByRole("button", { name: "Twitch viewers", exact: true }).click();
  await expect(twitch).toBeVisible();
  await expect(reviews).toBeHidden();
  await expect(measures.getByRole("button", { name: "Twitch viewers", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(twitch.locator(".dd-measure-title")).toContainText("Watching on Twitch");
  await measures.getByRole("button", { name: "New reviews a day", exact: true }).click();
  await expect(reviews.locator(".dd-readout")).toHaveText(first, { useInnerText: true });
  // Touch-sized steppers beside the slider, and today's partial day named as such.
  const next = reviews.getByRole("button", { name: "Next day" });
  await next.click();
  await expect(reviews.locator(".dd-readout")).not.toHaveText(first, { useInnerText: true });
  for (const control of [next, reviews.getByRole("button", { name: "Previous day" }), slider]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await slider.press("End");
  await expect(reviews.locator(".dd-readout")).toContainText("today so far");
  // Updates are compared only when the record has one; the fixture has a hotfix alone.
  await expect(page.locator("#updates")).toContainText("No official update was released in the recorded days");
  await expect(page.locator("#daily-reviews")).not.toContainText(/warmer|cooler|mood/i);
});
