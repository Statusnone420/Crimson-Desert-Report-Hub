import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

test("the scanner alias redirects permanently to the canonical public Observatory", async ({ page, request }) => {
  for (const method of ["GET", "HEAD"]) {
    const response = await request.fetch("/scanner", { method, maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe("/observatory");
  }
  const withQuery = await request.get("/scanner?source=bookmark", { maxRedirects: 0 });
  expect(withQuery.status()).toBe(308);
  expect(withQuery.headers().location).toBe("/observatory?source=bookmark");

  const response = await page.goto("/scanner");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/observatory$/);
  await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://crimsonreporthub.com/observatory");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://crimsonreporthub.com/observatory");
});

test("the Method page links directly to the public Observatory", async ({ page }) => {
  await page.goto("/about");
  const link = page.locator('.method-row__more a').filter({ hasText: "Observatory" });
  await expect(link).toHaveAttribute("href", "/observatory");
});

test("old scanner bookmarks preserve the authenticated workspace destination", async ({ page }) => {
  const legacy = await page.request.get("/admin/source-monitor", { maxRedirects: 0 });
  expect(legacy.status()).toBe(307);
  expect(legacy.headers().location).toBe("/operator?view=scanner");
  await page.goto("/operator?view=scanner");
  await expect(page).toHaveURL(/\/admin\/login\?from=%2Foperator%3Fview%3Dscanner$/);

  await signInAsAdmin(page);
  await page.goto("/admin/source-monitor");
  await expect(page).toHaveURL(/\/operator\?view=scanner$/);
  await expect(page.locator(".operator-newspaper")).toBeVisible();
  const alias = await page.request.get("/scanner", { maxRedirects: 0 });
  expect(alias.status()).toBe(308);
  expect(alias.headers().location).toBe("/observatory");
});
