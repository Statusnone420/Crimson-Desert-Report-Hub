import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test("each published issue shows its own decorative image with a visible credit", async ({ page }) => {
  await page.goto("/issues");
  await waitForHydration(page);
  const cards = page.locator(".report-dispatch");
  await expect(cards).not.toHaveCount(0);
  const sources: (string | null)[] = [];
  for (const card of await cards.all()) {
    const image = card.locator(".dispatch-heading figure img");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("alt", "");
    await expect(card.locator(".dispatch-heading figcaption")).toHaveText("Image: Pearl Abyss");
    sources.push(await image.evaluate((element) => new URL(element.getAttribute("src")!, location.href).searchParams.get("url")));
  }
  expect(sources.every((source) => source?.startsWith("/official/"))).toBe(true);
  expect(new Set(sources).size).toBe(sources.length);
});
