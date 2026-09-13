import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

test("section navigation follows reading position and preserves native hashes and history", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/observatory");
  const nav = page.getByRole("navigation", { name: "Observatory sections" });
  const platform = nav.getByRole("link", { name: "Platform activity", exact: true });
  await platform.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#platform-activity$/);
  await expect(page.locator("#platform-activity")).toBeFocused();
  await expect(platform).toHaveAttribute("aria-current", "location");
  const position = await page.locator("#platform-activity").boundingBox();
  const navigation = await nav.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height - 2);
  await nav.getByRole("link", { name: "The source radar", exact: true }).click();
  await expect(page).toHaveURL(/#scanner-radar$/);
  await page.goBack();
  await expect(page).toHaveURL(/#platform-activity$/);
  await expect(platform).toHaveAttribute("aria-current", "location");
  await page.locator("#review-record").evaluate((element) => element.scrollIntoView());
  await expect(nav.getByRole("link", { name: "The review record", exact: true })).toHaveAttribute("aria-current", "location");
  // Reading does not create extra history entries or replace a shared deep link.
  await expect(page).toHaveURL(/#platform-activity$/);
  expect(errors).toEqual([]);
});

for (const article of ["patch-2-02-00", "charting-the-unknown"]) {
  test(`${article} keeps mobile and desktop contents complete and sources reachable`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/articles/${article}`);
    const desktop = page.locator(".article-rail .section-nav");
    const mobile = page.locator(".mobile-contents .section-nav");
    const hrefs = (selector: string) => page.locator(selector).evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(await hrefs(".article-rail .section-nav a")).toEqual(await hrefs(".mobile-contents .section-nav a"));
    const nav = testInfo.project.name === "mobile-chromium" ? mobile : desktop;
    if (testInfo.project.name === "mobile-chromium") await page.getByText("Jump to a section", { exact: true }).click();
    await nav.getByRole("link", { name: "Sources & updates", exact: true }).click();
    await expect(page).toHaveURL(/#sources$/);
    await expect(page.locator("#sources")).toBeInViewport();
    await expect(page.locator("#sources")).toBeFocused();
    await expect(nav.getByRole("link", { name: "Sources & updates", exact: true })).toHaveAttribute("aria-current", "location");
    const source = page.locator("#sources .reading-link").first();
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noreferrer noopener");
    await source.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(source).toBeFocused();
    expect(await source.evaluate((link) => getComputedStyle(link).outlineStyle)).toBe("solid");
    await expect(page.locator(".article-bottom").getByRole("link", { name: "Back to top", exact: true })).toHaveAttribute("href", /^#(article-top|main-top)$/);
    if (article === "charting-the-unknown") await expect(page.locator(".reading-progress")).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"]) {
  test(`shared reading controls remain usable across the public site in ${theme}`, async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await page.addInitScript((selectedTheme) => localStorage.setItem("newspaper-theme", selectedTheme), theme);
    await page.clock.setFixedTime(new Date("2026-07-20T00:10:00Z"));
    const routes = ["/", "/news", "/watch", "/issues", "/patches", "/observatory", "/about", "/privacy", "/catch-up", "/articles/patch-2-02-00", "/articles/charting-the-unknown"];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator(".reading-link").first()).toBeVisible();
      const defects = await page.locator(".reading-link").evaluateAll((links) => links.flatMap((link) => {
        const rect = link.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        return rect.height < 43.5 ? [{ text: link.textContent, height: rect.height }] : [];
      }));
      expect(defects, route).toEqual([]);
      await expectHealthyPage(page, problems);
      if (route === "/observatory" || route === "/articles/patch-2-02-00") {
        if (route === "/observatory") {
          await page.getByRole("navigation", { name: "Observatory sections" }).getByRole("link", { name: "Platform activity", exact: true }).click();
          await expect(page.locator('.section-nav a[aria-current="location"]')).toHaveAttribute("href", "#platform-activity");
        } else if (testInfo.project.name === "mobile-chromium") {
          await page.getByText("Jump to a section", { exact: true }).click();
          await page.locator(".mobile-brief").evaluate((element) => element.scrollIntoView());
        } else {
          await page.locator("#sources").evaluate((element) => element.scrollIntoView());
        }
        await page.evaluate(() => document.fonts.ready);
        mkdirSync("output/reading-interactions", { recursive: true });
        await page.screenshot({ path: `output/reading-interactions/${route === "/observatory" ? "observatory" : "article"}-${theme}-${testInfo.project.name}.png`, animations: "disabled" });
      }
      if (testInfo.project.name === "mobile-chromium") {
        await page.setViewportSize({ width: 320, height: 844 });
        await expectHealthyPage(page, problems);
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
    await page.goto("/issues");
    await expect(page.locator('a[href="/about#method"]')).toHaveCount(0);
    await page.goto("/about#registers");
    await expect(page.locator("#registers")).toBeInViewport();
  });
}

test("confirmed CSS collisions no longer distort shared reading controls", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("newspaper-theme", "dark"));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const defects = await page.evaluate(() => {
    const problems: string[] = [];
    const styleOf = (element: Element) => getComputedStyle(element);
    const visible = (selector: string) => [...document.querySelectorAll(selector)].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    });

    for (const link of visible(".stories article .reading-link--action")) {
      const style = styleOf(link);
      const parent = link.parentElement?.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      if (Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom) > 1) {
        problems.push(`stories padding ${style.padding} on ${link.textContent?.trim()}`);
      }
      if (parent && box.width / parent.width > 0.92) {
        problems.push(`stories stretch ${Math.round(box.width)}/${Math.round(parent.width)} on ${link.textContent?.trim()}`);
      }
    }

    for (const link of visible(".report-actions .reading-link--action")) {
      const style = styleOf(link);
      if (Number.parseFloat(style.paddingLeft) < 12 || Number.parseFloat(style.paddingRight) < 12) {
        problems.push(`report-actions padding ${style.padding}`);
      }
    }

    for (const link of visible(".charts .reading-link")) {
      const svg = link.querySelector("svg");
      if (!svg) continue;
      const svgStyle = styleOf(svg);
      if (svgStyle.margin !== "0px") problems.push(`charts svg margin ${svgStyle.margin}`);
      if (svgStyle.width !== "18px" || svgStyle.height !== "18px") problems.push(`charts svg size ${svgStyle.width} ${svgStyle.height}`);
      const icon = link.querySelector(".reading-link__icon");
      if (icon) {
        const iconBox = icon.getBoundingClientRect();
        const svgBox = svg.getBoundingClientRect();
        const dx = Math.abs((svgBox.left + svgBox.width / 2) - (iconBox.left + iconBox.width / 2));
        const dy = Math.abs((svgBox.top + svgBox.height / 2) - (iconBox.top + iconBox.height / 2));
        if (dx > 2 || dy > 2) problems.push(`charts arrow offset ${dx.toFixed(1)},${dy.toFixed(1)}`);
      }
    }

    return problems;
  });
  expect(defects).toEqual([]);

  const wireLink = page.locator(".np-wire .reading-link--action").first();
  if (await wireLink.count()) {
    const wire = await wireLink.evaluate((link) => {
      const parent = link.parentElement?.getBoundingClientRect();
      const box = link.getBoundingClientRect();
      return parent ? box.width / parent.width : 1;
    });
    expect(wire).toBeLessThan(0.85);
  }

  await page.goto("/watch");
  await page.evaluate(() => document.fonts.ready);
  const watch = await page.locator(".watch-copy .reading-link--action").first().evaluate((link) => {
    const parent = link.parentElement?.getBoundingClientRect();
    const box = link.getBoundingClientRect();
    const style = getComputedStyle(link);
    return {
      stretch: parent ? box.width / parent.width : 1,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingBottom: Number.parseFloat(style.paddingBottom),
    };
  });
  expect(watch.stretch).toBeLessThan(0.85);
  expect(Math.abs(watch.paddingTop - watch.paddingBottom)).toBeLessThanOrEqual(1);

  await page.goto("/issues");
  const method = page.locator(".board-method a").filter({ hasText: "Read the method" });
  await expect(method).toHaveAttribute("href", "/about#registers");
  await expect(method).not.toHaveClass(/reading-link/);
  expect(await method.evaluate((link) => getComputedStyle(link).display)).not.toBe("flex");
});

test("reading actions keep hover, focus, and reduced-motion cues without changing the box", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const action = page.locator(".front-page-secondary .reading-link--action").first();
  await expect(action).toBeVisible();
  const rest = await action.evaluate((link) => {
    const style = getComputedStyle(link);
    const svg = link.querySelector("svg");
    return {
      padding: style.padding,
      width: link.getBoundingClientRect().width,
      transform: svg ? getComputedStyle(svg).transform : "none",
    };
  });
  await action.hover();
  const hover = await action.evaluate((link) => {
    const style = getComputedStyle(link);
    const svg = link.querySelector("svg");
    return {
      padding: style.padding,
      width: link.getBoundingClientRect().width,
      color: style.color,
      transform: svg ? getComputedStyle(svg).transform : "none",
    };
  });
  expect(hover.padding).toBe(rest.padding);
  expect(Math.abs(hover.width - rest.width)).toBeLessThanOrEqual(2);
  expect(hover.transform).toBe("none");
  await action.focus();
  expect(await action.evaluate((link) => getComputedStyle(link).outlineStyle)).toBe("solid");
});
