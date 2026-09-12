import { expect, test } from "@playwright/test";

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
