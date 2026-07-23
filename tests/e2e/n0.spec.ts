import { expect, test } from "@playwright/test";

test("all public surfaces remain complete and calm with zero community input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
  // The lead stays useful at N=0, while the pulse states that quiet is a real
  // reading instead of turning the empty database into the headline.
  await expect(page.getByText(/Patch .* is live\. Here’s what changed and what to watch\./)).toBeVisible();
  await expect(page.getByText("No player signals filed yet this patch. A quiet board is a real reading.")).toBeVisible();
  await expect(page.getByText(/No published issues yet for/)).toBeVisible();
  await expect(page.getByText(/be the first|waiting on the community|players testing|until a player report/i)).toHaveCount(0);
  // Modules with nothing to say close ranks instead of rendering empty shells.
  await expect(page.getByText("03 · The Claims Record")).toHaveCount(0);
  await expect(page.getByText("04 · From The Wire")).toHaveCount(0);
  // No scanner config means no radar band — it closes ranks too, no fake zeros.
  await expect(page.getByText("· The Radar")).toHaveCount(0);
  // Scanner analytics stay off the homepage even at N=0.
  await expect(page.getByRole("tab")).toHaveCount(0);

  // Silence is never green: zero-count numerals stay neutral ink.
  const statColor = await page
    .locator(".pulse-stat__value")
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  const green = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--green)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(statColor).not.toBe(green);

  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "What players are reporting" })).toBeVisible();
  await expect(page.getByText(/No published issues yet for/)).toBeVisible();
  await expect(page.getByRole("link", { name: "File a report", exact: true })).toHaveAttribute("href", "/report");
  await expect(page.getByText(/be the first|waiting on the community|players testing/i)).toHaveCount(0);

  await page.goto("/scanner");
  await expect(page.getByRole("heading", { name: "How the radar reads the web" })).toBeVisible();
  await expect(page.getByText("Scanner unavailable").first()).toBeVisible();
  await expect(page.getByText("No mapped radar questions are available in this environment.")).toBeVisible();
  await expect(page.getByText(/be the first|waiting on the community|players testing/i)).toHaveCount(0);
});
