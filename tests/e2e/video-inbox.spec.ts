import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const PRIVATE_NOTE = "Invented review note for the private inbox screenshot.";
const PENDING_TITLE = "Fixture expansion commentary for inbox tests";

test.describe("private video review inbox", () => {
  test("unauthenticated visitors cannot open the inbox", async ({ page }) => {
    const response = await page.goto("/admin/videos");
    expect(response?.ok()).toBeTruthy();
    await page.waitForURL(/\/admin\/login/);
    expect(page.url()).toContain("from=%2Fadmin%2Fvideos");
    await expect(page.getByRole("heading", { name: "Admin sign-in" })).toBeVisible();
    await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
  });

  test("signed-in owner sees the private queue without changing Watch", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/admin/videos");
    await expect(page.getByRole("heading", { name: "Video review" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Videos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { name: PENDING_TITLE })).toBeVisible();
    await expect(page.locator("article[data-video-state='pending'] .review-item__body")).toHaveText(PRIVATE_NOTE);
    await expect(page.locator("article[data-video-state='pending']")).toHaveCount(1);
    await expect(page.locator("article[data-video-state='draft_ready']")).toHaveCount(1);
    await expect(page.locator("article[data-video-state='skipped']")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Download draft" })).toBeVisible();
    const artifactDir = "/opt/cursor/artifacts/video-inbox";
    mkdirSync(artifactDir, { recursive: true });
    const project = test.info().project.name;
    await page.screenshot({
      path: `${artifactDir}/${project}-queue.png`,
      fullPage: true,
    });

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
