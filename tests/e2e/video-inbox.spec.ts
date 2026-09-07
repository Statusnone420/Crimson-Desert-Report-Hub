import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const PRIVATE_NOTE = "Invented review note for the private inbox screenshot.";

test.describe("private video review inbox", () => {
  test("unauthenticated visitors cannot open the inbox", async ({ page }) => {
    const response = await page.goto("/admin/videos");
    expect(response?.ok()).toBeTruthy();
    await page.waitForURL(/\/admin\/login/);
    expect(page.url()).toContain("from=%2Fadmin%2Fvideos");
    await expect(page.getByRole("heading", { name: "Admin sign-in" })).toBeVisible();
    await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
  });

  test("signed-in owner can review, skip, and approve without changing Watch", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/admin/videos");
    await expect(page.getByRole("heading", { name: "Video review" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "Videos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText(PRIVATE_NOTE)).toBeVisible();
    await expect(page.getByText("Pending")).toBeVisible();
    await expect(page.getByText("Draft ready")).toBeVisible();
    await expect(page.getByText("Skipped")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download draft" })).toBeVisible();

    const pendingCard = page.locator("article").filter({ hasText: PRIVATE_NOTE });
    await pendingCard.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByText("Skipped")).toBeVisible();

    await page.getByLabel("YouTube URL", { exact: true }).first().fill("https://youtu.be/zzInboxAdd1");
    await page.getByLabel("Title", { exact: true }).first().fill("Crimson Desert added fixture commentary");
    await page.getByLabel("Channel", { exact: true }).first().fill("FixtureChannel");
    await page.getByLabel("Review note").first().fill("Second invented inbox note.");
    await page.getByRole("button", { name: "Add to inbox" }).click();
    await expect(page.getByText("Crimson Desert added fixture commentary")).toBeVisible();

    const added = page.locator("article").filter({ hasText: "Crimson Desert added fixture commentary" });
    await added.getByRole("button", { name: "Approve draft" }).click();
    await expect(added.getByText(/Draft incomplete|Draft complete|Private publication draft/)).toBeVisible();

    await added.getByRole("button", { name: "Approve draft" }).click();
    await expect(page.getByText("Crimson Desert added fixture commentary")).toHaveCount(1);

    await page.goto("/watch");
    await expect(page.getByRole("heading", { name: "Crimson Desert, in motion" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch the official reveal ↗" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=HaCtG1F_hfE",
    );
    await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
    await expect(page.getByText("zzInboxMock")).toHaveCount(0);
    await expect(page.getByText("zzInboxAdd1")).toHaveCount(0);
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
