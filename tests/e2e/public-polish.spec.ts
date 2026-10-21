import { expect, test } from "@playwright/test";
import { signInAsAdmin, waitForHydration } from "./helpers";

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

test("the retired report path permanently redirects to the issue board", async ({ page, request }) => {
  const response = await request.get("/report?issue=00000000-0000-4000-8000-000000000002", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/issues#issue-00000000-0000-4000-8000-000000000002");
  const retiredWrite = await request.post("/api/reports", { data: {} });
  expect(retiredWrite.status()).toBe(410);
  await expect(retiredWrite.json()).resolves.toEqual({ error: "reports_retired" });
  await page.goto("/report");
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.locator("#report-form")).toHaveCount(0);
});

test("a changed thumb stays on its patch while a fresh hotfix starts with its own local key", async ({ page }) => {
  const clusterId = "00000000-0000-4000-8000-000000000001";
  await page.addInitScript(({ currentKey, hotfixKey }) => {
    localStorage.setItem(currentKey, "up");
    localStorage.setItem(hotfixKey, "up");
    Object.assign(window, { turnstile: {
      render(container: HTMLElement, options: { callback?: (token: string) => void }) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "cf-turnstile-response";
        input.value = "test-turnstile-token";
        container.append(input);
        options.callback?.(input.value);
        return "test-widget";
      },
      remove: () => {},
    } });
  }, {
    currentKey: `cd-thumb-${clusterId}-1.13.01`,
    hotfixKey: `cd-thumb-${clusterId}-1.13.02`,
  });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/api/thumbs", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, direction: "down", patch_version: "1.13.01" }),
  }));
  await page.goto("/issues");
  await waitForHydration(page);
  const card = page.locator(`#issue-${clusterId}`);
  await expect(card.getByRole("button", { name: "Happening to me", exact: true })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Not happening for me", exact: true }).click();
  await expect(card.getByRole("button", { name: "Not happening for me", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(({ currentKey, hotfixKey }) => ({
    current: localStorage.getItem(currentKey),
    hotfix: localStorage.getItem(hotfixKey),
  }), {
    currentKey: `cd-thumb-${clusterId}-1.13.01`,
    hotfixKey: `cd-thumb-${clusterId}-1.13.02`,
  })).toEqual({ current: "down", hotfix: "up" });
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
