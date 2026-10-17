import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

async function inspectSelectedProvider(page: Page) {
  await page.getByRole("button", { name: "Inspect sample model", exact: true }).click();
  if (await page.getByLabel("Provider endpoint", { exact: true }).inputValue() === "") {
    await expect(page.getByRole("button", { name: "Run sample test", exact: true })).toBeDisabled();
    await page.getByLabel("Provider endpoint", { exact: true }).selectOption("sample-provider");
    await page.getByRole("button", { name: "Inspect sample model", exact: true }).click();
  }
}

const PRIVATE_OR_PROVIDER = /\/api\/admin\/ai-settings|openai\.com|openrouter\.ai|supabase\.(co|com)/i;

test("reopening setup preserves the active policy and cancellation leaves it unchanged", async ({ page }) => {
  const effects: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" || PRIVATE_OR_PROVIDER.test(request.url())) effects.push(request.url());
  });
  await signInAsAdmin(page);
  await page.goto("/operator?view=ai");
  await page.getByRole("button", { name: "Set up a model", exact: true }).click();
  await page.getByLabel("Reasoning", { exact: true }).selectOption("high");
  await page.getByLabel("Data retention", { exact: true }).selectOption("zdr");
  await page.getByLabel("Maximum output tokens", { exact: true }).fill("768");
  await inspectSelectedProvider(page);
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await page.getByRole("button", { name: "Activate model in preview", exact: true }).click();
  const active = await page.locator(".ai-model-row").first().textContent() ?? "";
  for (let reopen = 0; reopen < 2; reopen++) {
    await page.getByRole("button", { name: "Set up a model", exact: true }).click();
    await expect(page.getByLabel("OpenRouter model ID", { exact: true })).toHaveValue("sample/openrouter/issue-reader");
    await expect(page.getByLabel("Provider endpoint", { exact: true })).toHaveValue("sample-provider");
    await expect(page.getByLabel("Reasoning", { exact: true })).toHaveValue("high");
    await expect(page.getByLabel("Data retention", { exact: true })).toHaveValue("zdr");
    await expect(page.getByLabel("Maximum output tokens", { exact: true })).toHaveValue("768");
    await page.getByLabel("Reasoning", { exact: true }).selectOption("none");
    await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
    await expect(page.locator(".ai-model-row").first()).toHaveText(active);
  }
  expect(effects).toEqual([]);
});

test("AI settings requires the existing operator sign-in", async ({ page }) => {
  await page.goto("/operator?view=ai");
  await expect(page).toHaveURL(/\/admin\/login\?/);
  await expect(page.getByRole("heading", { name: "AI settings", exact: true })).toHaveCount(0);
});

test("the shared AI settings UI keeps its design preview local and resets on reload", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  const effects: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" || PRIVATE_OR_PROVIDER.test(request.url())) effects.push(`${request.method()} ${request.url()}`);
  });
  await signInAsAdmin(page);
  await page.goto("/operator?view=ai");

  await expect(page.getByRole("navigation", { name: "Operator" }).getByRole("link", { name: "AI settings" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Design preview · sample data", { exact: true })).toBeVisible();
  await expect(page.getByText(/No provider or server is contacted/)).toBeVisible();
  await expect(page.locator(".ai-current .ai-model-name")).toHaveText("Sample Issue Reader");

  await page.getByRole("button", { name: "View sample connection" }).click();
  await expect(page.getByLabel("OpenRouter API key", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("OpenRouter API key", { exact: true })).toHaveAttribute("placeholder", "Unavailable in design preview");
  await page.getByRole("button", { name: "Set up a model", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up a model", exact: true })).toBeFocused();

  const modelId = page.getByLabel("OpenRouter model ID", { exact: true });
  await modelId.fill("sample/openrouter/backup-reader");
  await inspectSelectedProvider(page);
  await expect(page.getByText("Sample metadata", { exact: true })).toBeVisible();
  await expect(page.locator(".ai-capabilities")).toContainText("Sample provider · sample-provider");
  await expect(page.getByText(/not a current price quote/)).toBeVisible();
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample Backup Reader · sample scanner check" }).first()).toBeVisible();
  await expect(page.getByText("6 of 6 sample cases passed", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.00 · no provider call", { exact: true })).toBeVisible();
  await expect(page.locator(".ai-test-results > .ai-description")).toContainText("high reasoning");

  await page.getByLabel("Reasoning", { exact: true }).selectOption("medium");
  await page.getByLabel("Data retention", { exact: true }).selectOption("zdr");
  await page.getByLabel("Maximum output tokens", { exact: true }).fill("768");
  await expect(page.getByRole("button", { name: "Activate model in preview" })).toHaveCount(0);
  await inspectSelectedProvider(page);
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByRole("button", { name: "Activate model in preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activate model in preview", exact: true }).click();
  await expect(page.locator(".ai-current .ai-model-name")).toHaveText("Sample Backup Reader");
  await expect(page.locator(".ai-model-row").first()).toContainText("medium reasoning · Zero data retention required · 768 output tokens maximum");
  await expect(page.getByRole("status")).toContainText("No production settings changed.");
  await page.getByRole("button", { name: "Restore previous model", exact: true }).click();
  await expect(page.locator(".ai-current .ai-model-name")).toHaveText("Sample Issue Reader");

  await page.getByRole("button", { name: "Set up a model", exact: true }).click();
  await page.getByLabel("OpenRouter model ID", { exact: true }).fill("sample/openrouter/backup-reader");
  await inspectSelectedProvider(page);
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await page.getByLabel("Use this model as", { exact: true }).selectOption("backup");
  await page.getByRole("button", { name: "Activate model in preview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample Backup Reader" })).toBeVisible();

  await page.getByRole("button", { name: "Spending & recovery", exact: true }).click();
  await page.getByRole("radio", { name: /Use my approved backup/ }).check();
  await page.getByLabel("Monthly allowance (USD)", { exact: true }).fill("2.00");
  await page.getByRole("button", { name: "Save preview settings", exact: true }).click();
  await expect(page.locator(".ai-budget-facts")).toContainText("$2.00");

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample Backup Reader · sample scanner check" }).first()).toBeVisible();
  await expect(page.getByText("Previous model restored", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page.reload();
  await expect(page.locator(".ai-current .ai-model-name")).toHaveText("Sample Issue Reader");
  await expect(page.getByRole("heading", { name: "No backup selected" })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expectHealthyPage(page, problems);
  expect(effects).toEqual([]);
});

test("unknown models, timeouts and invalid samples cannot activate", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/operator?view=ai");
  await page.getByRole("button", { name: "Set up a model", exact: true }).click();

  const modelId = page.getByLabel("OpenRouter model ID", { exact: true });
  await modelId.fill("sample/openrouter/not-in-catalog");
  await page.getByRole("button", { name: "Inspect sample model", exact: true }).click();
  await expect(page.locator(".workspace-error[role=alert]")).toContainText("not in the sample catalogue");
  await expect(page.getByRole("button", { name: "Run sample test", exact: true })).toHaveCount(0);

  await modelId.fill("sample/openrouter/issue-reader");
  await inspectSelectedProvider(page);
  const outcome = page.getByLabel("Sample test scenario", { exact: true });
  await outcome.selectOption("timeout");
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByText(/Sample timeout: a live request could have an unknown provider charge/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate model in preview" })).toHaveCount(0);

  await outcome.selectOption("invalid");
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByText("invalid response", { exact: true })).toBeVisible();
  await expect(page.getByText("Did not pass", { exact: true })).toHaveClass(/ai-status--quiet/);
  await expect(page.getByRole("button", { name: "Activate model in preview" })).toHaveCount(0);
});

test("AI settings stays readable in light and dark themes without horizontal overflow", async ({ page }, testInfo) => {
  test.slow(); // Capture six interactive states in both themes and viewport sizes.
  const problems = collectConsoleProblems(page);
  await signInAsAdmin(page);
  await page.goto("/operator?view=ai");
  async function captureState(name: string) {
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => window.scrollY === 0);
        await expectHealthyPage(page, problems);
        const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
        expect(widths.content, `${name}: ${theme} at ${width}px`).toBeLessThanOrEqual(widths.viewport);
        await page.screenshot({ path: testInfo.outputPath(`ai-${name}-${theme}-${width}.png`), fullPage: true, animations: "disabled", style: "nextjs-portal { display: none !important; }" });
      }
    }
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectHealthyPage(page, problems);
      const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(widths.content, `${theme} theme at ${width}px`).toBeLessThanOrEqual(widths.viewport);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`ai-settings-${theme}-${width}.png`), fullPage: true, style: "nextjs-portal { display: none !important; }" });
      }
    }
  }
  await page.getByRole("button", { name: "Set up a model", exact: true }).click();
  await inspectSelectedProvider(page);
  await captureState("inspected");
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample Issue Reader · sample scanner check" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 1000 });
  await expectHealthyPage(page, problems);
  const setupWidths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(setupWidths.content).toBeLessThanOrEqual(setupWidths.viewport);
  await captureState("passed");
  await page.getByLabel("Sample test scenario", { exact: true }).selectOption("invalid");
  await page.getByRole("button", { name: "Run sample test", exact: true }).click();
  await expect(page.getByText("invalid response", { exact: true })).toBeVisible();
  await page.getByText("Did not pass", { exact: true }).click();
  await captureState("failed");
  await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
  await page.getByRole("button", { name: "Spending & recovery", exact: true }).click();
  await captureState("policy");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await captureState("activity");
});
