import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`issue categories paint their icons and dividers in ${theme} mode`, async ({ page }) => {
    await page.goto("/issues");
    await expect(page.getByRole("button", { name: "Catch me up", exact: true })).toBeEnabled();
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.getByRole("button", { name: `Switch to ${theme === "dark" ? "light" : "dark"} mode` })).toBeVisible();

    const masks = new Set<string>();
    for (const view of ["Published issues", "Watchlist"]) {
      if (view === "Watchlist") await page.getByRole("button", { name: /^Watchlist / }).click();
      const records = await page.locator(".report-dispatch, .watch-index-category, .watch-category").evaluateAll((elements) => elements.map((element) => {
        const icon = element.querySelector(".category-symbol")!;
        const style = getComputedStyle(icon);
        return {
          category: element.className, ink: style.getPropertyValue("--category-ink").trim(),
          background: style.backgroundColor, mask: style.maskImage,
          width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height,
          divider: element.matches(".report-dispatch, .watch-category") ? Number.parseFloat(getComputedStyle(element).borderTopWidth) : null,
        };
      }));
      if (view === "Published issues") expect(records.length).toBeGreaterThan(1);
      expect(records.filter((record) => !record.ink || record.background === "rgba(0, 0, 0, 0)" || record.mask === "none" || record.width < 20 || record.height < 20 || record.divider === 0)).toEqual([]);

      for (const record of records) masks.add(record.mask);
    }

    for (const mask of masks) {
      const url = mask.match(/^url\("(.*)"\)$/)?.[1];
      expect(url).toBeTruthy();
      const response = await page.request.get(url!);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/svg+xml");
    }
  });
}
