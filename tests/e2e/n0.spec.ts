import { expect, test, type Page } from "@playwright/test";

const CROWD_COPY = /be the first|waiting on the community|players testing|until a player report/i;

async function expectNoSyntheticCrowd(page: Page) {
  await expect(page.getByText(CROWD_COPY)).toHaveCount(0);
}

async function expectNotGreen(page: Page, selector: string) {
  const colors = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  const green = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--green)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(colors.length).toBeGreaterThan(0);
  expect(colors).not.toContain(green);
}

test("missing services stay unavailable instead of becoming a false zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Beyond Pywel’s familiar shores" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Official claims are unavailable." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report counts unavailable" })).toBeVisible();
  await expect(page.getByText("The scanner record could not be read. Counts are unavailable.")).toBeVisible();
  await expect(page.getByText("Steam review history could not be read.")).toBeVisible();
  await expect(page.getByText(/0 reports this patch|0 scanner leads|No claimed fixes are recorded/)).toHaveCount(0);
  await expectNotGreen(page, ".np-error, .stories h2");
  await expectNoSyntheticCrowd(page);

  await page.goto("/patches");
  await expect(page.getByRole("heading", { name: /^Patch / })).toBeVisible();
  await expect(page.getByText("unreadable", { exact: true })).toHaveCount(3);
  await expect(page.getByText("The player record could not be read right now.")).toBeVisible();
  await expect(page.getByText(/0 official fix claims|0 player reports/)).toHaveCount(0);
  await expectNoSyntheticCrowd(page);

  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "The issue board is unavailable." })).toBeVisible();
  await expect(page.getByText("This is not a report that no issues are being tracked.")).toBeVisible();
  await expect(page.getByRole("link", { name: "File a player report" })).toHaveAttribute("href", "/report");
  await expectNoSyntheticCrowd(page);

  await page.goto("/observatory");
  await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
  await expect(page.getByText("Steam review history is unavailable because no recorded snapshots are available.")).toBeVisible();
  await expect(page.getByText("Twitch aggregate history is unavailable because no complete captures are available in this window.")).toBeVisible();
  await expect(page.getByText("Radar category data is unavailable because no recorded category counts are available.")).toBeVisible();
  await expectNotGreen(page, ".np-error");
  await expectNoSyntheticCrowd(page);

  await page.goto("/scanner");
  await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Observatory" })).toHaveAttribute("aria-current", "page");
  await expectNoSyntheticCrowd(page);

  await page.goto("/report");
  await expect(page.getByRole("heading", { name: "Tell us what happened." })).toBeVisible();
  await expect(page.getByText("No account. No email.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review report" })).toBeVisible();
  await expectNoSyntheticCrowd(page);
});

test("connected empty tables render honest zero states", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "0 reports this patch" })).toBeVisible();
  await expect(page.getByText("Published issues").locator("+ dd")).toHaveText("0");
  await expect(page.getByText("No claimed fixes are recorded for this patch yet.")).toBeVisible();
  await expect(page.getByText("0 scanner leads · not confirmed bugs")).toBeVisible();
  await expect(page.getByText("No Steam review captures are available yet.")).toBeVisible();
  await expect(page.getByText(/unavailable|could not be read/i)).toHaveCount(0);
  await expectNotGreen(page, ".stories aside h2, .stories aside dd");
  await expectNoSyntheticCrowd(page);

  await page.goto("/issues");
  await expect(page.getByRole("heading", { name: "The player record." })).toBeVisible();
  await expect(page.getByRole("heading", { name: /No published issues yet for/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Published reports 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Watchlist 0" })).toBeVisible();
  await expectNotGreen(page, ".board-view-count");
  await expectNoSyntheticCrowd(page);

  await page.goto("/patches");
  await expect(page.getByText("0", { exact: true })).toHaveCount(3);
  await expect(page.getByText("These are different records. An official fix claim does not establish that a player’s issue is resolved.")).toBeVisible();
  await expect(page.getByText("A quiet board does not mean every issue is fixed.")).toBeVisible();
  await expectNoSyntheticCrowd(page);

  await page.goto("/observatory");
  await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
  await expect(page.getByText("Steam review history is unavailable because no recorded snapshots are available.")).toBeVisible();
  await expect(page.getByText("Radar category data is unavailable because no recorded category counts are available.")).toBeVisible();
  await expect(page.getByText(/0 recorded readings|0 players|0 confirmed bugs/i)).toHaveCount(0);
  await expectNoSyntheticCrowd(page);
});
