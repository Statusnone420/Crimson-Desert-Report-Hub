import { expect, test } from "@playwright/test";
import { expectHealthyPage, signInAsAdmin, waitForHydration } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("private trigger evidence names missing setup and stays readable", async ({ page }) => {
  await page.goto("/operator?view=scanner");
  const card = page.getByRole("region", { name: "Scheduled execution evidence" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Execution evidence not configured", { exact: true })).toBeVisible();
  await expect(card.getByText(/Private trigger diagnostics are not connected/)).toBeVisible();
  await expect(card.getByText("Unknown", { exact: true })).toHaveCount(0);
  await expectHealthyPage(page, []);
  await expect(page.getByRole("button", { name: "Report a problem", exact: true })).toBeVisible();
  // The root-level floating control is covered by problem-reports.spec.ts.
  // Keep this existing baseline focused on the scanner card underneath it.
  const screenshotStyle = await page.addStyleTag({ content: ".problem-report-trigger { visibility: hidden !important; }" });
  try { await expect(card).toHaveScreenshot("scanner-execution-unconfigured.png"); }
  finally { await screenshotStyle.evaluate((element) => element.parentNode?.removeChild(element)); }
});

test("a failed manual start explains its stage and warns about uncertain writes", async ({ page }) => {
  await page.route("**/api/admin/scan", (route) => route.fulfill({ status: 503, json: {
    error: "scan_start_failed", attemptId: "214ff53e-dc69-4792-90b0-ea074a137685",
    diagnostic: { stage: "run_create", code: "database_timeout" },
  } }));
  await page.goto("/operator?view=scanner");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Run capped scan now" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Creating the run record" })).toContainText("a timed-out write may still have committed");
  await expect(page.getByRole("alert").filter({ hasText: "Creating the run record" })).toContainText("214ff53e-dc69-4792-90b0-ea074a137685");
});

test("a partial manual completion keeps its failure visible", async ({ page }) => {
  await page.route("**/api/admin/scan", (route) => route.fulfill({ json: { runId: "fixture-partial-run" } }));
  await page.route("**/api/admin/scan/status?*", (route) => route.fulfill({ json: {
    id: "fixture-partial-run", status: "partial", mode: "manual", errors: ["Progress write failed"],
    progress: { stage: "done", searchesDone: 1, searchTotal: 1, candidatesSeen: 4, prefilterRejected: 1, llmCallsUsed: 1, kept: 1, promoted: 0,
      diagnostics: [{ stage: "progress_write", code: "database_timeout" }] },
  } }));
  await page.goto("/operator?view=scanner");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Run capped scan now" }).click();
  await expect(page.getByText("Scan finished with failures", { exact: false })).toBeVisible();
  await expect(page.getByText(/Saving scan progress: The database request timed out/)).toBeVisible();
});
