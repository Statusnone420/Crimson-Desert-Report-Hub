import { expect, test } from "@playwright/test";

test("all public surfaces remain complete and calm with zero community input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
  await expect(page.getByText("No reports this patch")).toBeVisible();
  await expect(page.getByText("No watched issue has enough signal yet.")).toBeVisible();
  await expect(page.getByText(/be the first|waiting on the community|players testing|until a player report/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Reviewed versus survived screening" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Funnel view/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the internet is saying" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What players are asking for" })).toHaveCount(0);
  await expect(page.getByText("Activity appears after the scanner records its first intake.")).toBeVisible();
  await page.getByRole("tab", { name: /Funnel view/ }).click();
  await expect(page.getByRole("heading", { name: "From public chatter to a board lead" })).toBeVisible();
  await expect(page.getByText("The timeline starts with the first tracked patch.")).toBeVisible();

  const reportStat = page.getByText("Player-reported issues", { exact: true }).locator("..");
  const reportStatColor = await reportStat.locator(".metric-card__value").evaluate((node) => getComputedStyle(node).color);
  const green = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--green-bright)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(reportStatColor).not.toBe(green);

  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "What players are reporting" })).toBeVisible();
  await expect(page.getByText("No public issue clusters yet.")).toBeVisible();
  await expect(page.getByText(/be the first|waiting on the community|players testing/i)).toHaveCount(0);

  await page.goto("/scanner");
  await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible();
  await expect(page.getByText("Scanner unavailable").first()).toBeVisible();
  await expect(page.getByText("No mapped radar questions are available in this environment.")).toBeVisible();
  await expect(page.getByText(/be the first|waiting on the community|players testing/i)).toHaveCount(0);
});
