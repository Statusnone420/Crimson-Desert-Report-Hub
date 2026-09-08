import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const PRIVATE_NOTE = "Invented review note for the private inbox screenshot.";
const PENDING_TITLE = "Fixture expansion commentary for inbox tests";

test.describe("private video review inbox", () => {
  test("unauthenticated visitors cannot open the inbox", async ({ page }) => {
    const response = await page.goto("/operator?view=videos");
    expect(response?.ok()).toBeTruthy();
    await page.waitForURL(/\/admin\/login/);
    expect(page.url()).toContain("from=%2Foperator%3Fview%3Dvideos");
    await expect(page.getByRole("heading", { name: "Admin sign-in" })).toBeVisible();
    await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
  });

  test("signed-in owner sees the private queue without changing Watch", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/operator?view=videos");
    await expect(page.getByRole("heading", { name: "Video review" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Videos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { name: PENDING_TITLE })).toBeVisible();
    const pending = page.locator("article[data-video-state='pending']");
    await pending.getByRole("button", { name: PENDING_TITLE }).click();
    const detail = page.getByRole("region", { name: /^Video details:/ });
    await expect(detail.getByLabel("Review note")).toHaveValue(PRIVATE_NOTE);
    await expect(page.locator("article[data-video-state='pending']")).toHaveCount(1);
    await expect(page.locator("article[data-video-state='draft_ready']")).toHaveCount(1);
    await expect(page.locator("article[data-video-state='skipped']")).toHaveCount(1);
    const ready = page.locator("article[data-video-state='draft_ready']");
    await ready.locator(".workspace-queue-item__select").click();
    await expect(detail.getByRole("link", { name: "Download draft" })).toBeVisible();
    const artifactDir = "output/playwright/video-inbox";
    mkdirSync(artifactDir, { recursive: true });
    const project = test.info().project.name;
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const failures = await page.locator(".video-workspace").evaluate((root) => {
        const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (channels: number[]) => channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        return Array.from(root.querySelectorAll("input:not([type=hidden]):not([type=checkbox]), select, textarea, .workspace-button, .workspace-queue-item, .workspace-note, .video-draft-preview")).flatMap((element) => {
          const style = getComputedStyle(element);
          let surface: Element | null = element;
          while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
          if (!surface) return ["missing background"];
          const foreground = luminance(rgb(style.color));
          const background = luminance(rgb(getComputedStyle(surface).backgroundColor));
          const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          return contrast >= 4.5 ? [] : [`${element.tagName}.${element.className}: ${contrast.toFixed(2)}`];
        });
      });
      expect(failures, `${theme} inbox text must remain readable`).toEqual([]);
      await page.screenshot({ path: `${artifactDir}/${project}-queue-${theme}.png`, fullPage: true, animations: "disabled", caret: "initial" });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });

    await page.goto("/watch");
    await expect(page.getByRole("heading", { name: "Crimson Desert, in motion" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch the official reveal ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=HaCtG1F_hfE",
    );
    await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
    await expect(page.getByText("zzInboxMock")).toHaveCount(0);
    await expect(page.getByText("zzInboxAdd1")).toHaveCount(0);
    await page.screenshot({
      path: `${artifactDir}/${project}-watch.png`,
      fullPage: true,
    });
    await expectHealthyPage(page, problems);
  });

  test("brief stays private and uncached", async ({ page }) => {
    const anonymous = await page.request.get("/api/admin/video-review-brief");
    expect(anonymous.status()).toBe(401);
    await signInAsAdmin(page);
    const authorized = await page.request.get("/api/admin/video-review-brief");
    expect(authorized.status()).toBe(200);
    expect(authorized.headers()["cache-control"]).toMatch(/no-store/);
    expect(authorized.headers()["x-robots-tag"]).toMatch(/noindex/);
    const body = await authorized.json();
    expect(body.status).toBe("ok");
    expect(JSON.stringify(body)).not.toContain("https://www.youtube.com/watch?v=zzInboxMock");
    expect(JSON.stringify(body)).not.toContain("After 20–30 minutes");
    expect(body.adminAttention.reportQueuePath).toBe("/admin");
  });
});
