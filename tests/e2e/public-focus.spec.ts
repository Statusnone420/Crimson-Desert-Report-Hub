import { expect, test, type Locator, type Page } from "@playwright/test";

async function openInTheme(page: Page, route: string, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(route);
  await expect(page.getByRole("button", { name: "Catch me up", exact: true })).toBeEnabled();
  if (await page.locator("html").getAttribute("data-theme") !== theme) {
    await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectKeyboardFocus(control: Locator, blue: string) {
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS("box-shadow", "none");
  await expect(control).toHaveCSS("outline-style", "solid");
  await expect(control).toHaveCSS("outline-width", "2px");
  await expect(control).toHaveCSS("outline-color", blue);
}

for (const theme of ["light", "dark"] as const) {
  const blue = theme === "light" ? "rgb(36, 87, 161)" : "rgb(130, 170, 240)";

  test(`Observatory sliders separate pointer and keyboard focus in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
    await openInTheme(page, "/observatory", theme);
    for (const name of ["Choose a review reading", "Choose a Twitch capture", "Choose a Steam player capture", "Choose a scan day"]) {
      const slider = page.getByRole("slider", { name, exact: true });
      await slider.scrollIntoViewIfNeeded();
      const before = await slider.boundingBox();
      const previousValue = await slider.inputValue();
      expect(before!.height).toBeGreaterThanOrEqual(44);

      if (isMobile) await slider.tap();
      else await slider.click();
      // Touch can update a native range without retaining DOM focus.
      await expect(slider).not.toHaveValue(previousValue);
      if (!isMobile) await expect(slider).toBeFocused();
      await expect(slider).toHaveCSS("box-shadow", "none");
      await expect(slider).toHaveCSS("outline-style", "none");
      if (name === "Choose a review reading") {
        await page.screenshot({ path: testInfo.outputPath("slider-pointer.png") });
      }

      await slider.press("Home");
      await expect(slider).toHaveValue("0");
      await expectKeyboardFocus(slider, blue);
      const firstReading = await slider.getAttribute("aria-valuetext");
      await slider.press("End");
      await expect(slider).toHaveValue((await slider.getAttribute("max"))!);
      await expect(slider).not.toHaveAttribute("aria-valuetext", firstReading!);
      const after = await slider.boundingBox();
      expect(after!.height).toBe(before!.height);
      expect(after!.width).toBe(before!.width);
      if (name === "Choose a review reading") {
        await page.screenshot({ path: testInfo.outputPath("slider-keyboard.png") });
      }
    }
  });

  test(`public controls keep one blue focus indicator in ${theme} mode`, async ({ page }, testInfo) => {
    await openInTheme(page, "/patches", theme);
    const search = page.getByRole("searchbox", { name: "Find a fix", exact: true });
    await search.click();
    await expectKeyboardFocus(search, blue);
    for (const control of [
      page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Patches", exact: true }),
      page.getByRole("button", { name: "Catch me up", exact: true }),
      page.locator("main summary").first(),
    ]) {
      // Enter through Tab so this checks actual keyboard focus, not just .focus().
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expectKeyboardFocus(control, blue);
    }

    await page.getByRole("button", { name: "Catch me up", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Catch up", exact: true });
    const remember = menu.getByRole("checkbox", { name: "Remember my place on this browser" });
    await remember.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(remember, blue);
    await page.screenshot({ path: testInfo.outputPath("checkbox-keyboard.png") });

    await menu.getByRole("tab", { name: "Date", exact: true }).click();
    const date = menu.getByLabel("Last played", { exact: true });
    await date.click();
    await expectKeyboardFocus(date, blue);
    await menu.getByRole("button", { name: "Close catch-up options", exact: true }).click();
  });
}
