import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

async function expectHealthyPage(page: Page, problems: string[]) {
  await expect(page.locator("body")).not.toHaveText("");
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Failed to compile/i)).toHaveCount(0);
  expect(problems).toEqual([]);
}

const settingsXml = `
<EngineOptionSave>
  <EngineOptionResolution Name="_resolutionOption">
    <OptionStringVector Name="_upscaleModeSelect" _value="NVIDIA DLSS 4.0"/>
    <EnumSelectResolutionScale Name="_upscaleResolution" _select="AA"/>
  </EngineOptionResolution>
  <EngineOptionVideo Name="_videoOption">
    <OptionBool Name="_enableFrameGeneration" _value="True"/>
    <OptionStringVector Name="_enableVsync" _value="Off"/>
    <OptionBool Name="_enableHDR" _value="True"/>
  </EngineOptionVideo>
</EngineOptionSave>`;

test.describe("public surface visual regression", () => {
  test("dashboard renders moderated patch intelligence", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await expect(page).toHaveTitle(/Crimson Desert Report Hub/i);
    await expect(page.getByRole("heading", { name: "Crimson Desert report hub" })).toBeVisible();
    await expect(page.getByText("Community signals", { exact: true })).toBeVisible();
    await expect(page.getByText("Direct reports", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI scanner watching public sources" })).toBeVisible();
    await expect(page.getByText("scheduled scans on")).toBeVisible();
    await expect(page.getByText(/\d+ signals · \d+ reports/).first()).toBeVisible();
    await expect(page.getByText("2 signals · 6 reports")).toBeVisible();
    await expect(page.getByText("FPS regression since 1.13")).toBeVisible();
    await expect(page.getByText("Map-open crash persists after fix")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
  });

  test("issue clusters show approved excerpts only", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/issues");

    await expect(page.getByRole("heading", { name: "Issue clusters" })).toBeVisible();
    await expect(page.getByText("Community signals").first()).toBeVisible();
    await expect(page.getByText("Approved excerpts").first()).toBeVisible();
    await expect(page.getByText("High confidence")).toBeVisible();
    await expect(page.getByText("Confirmed")).toHaveCount(0);
    await expect(page.getByText("private low confidence")).toHaveCount(0);
    await expect(page.getByText("Raw submissions are never published.")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("issues.png", { fullPage: true });
  });

  test("about page explains privacy and public source posture", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/about");

    await expect(page.getByRole("heading", { name: "About this tracker" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public source" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View the source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Statusnone420/Crimson-Desert-Report-Hub",
    );
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("about.png", { fullPage: true });
  });

  test("owner console unlocks admin shortcuts", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Owner" }).click();
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await page.getByLabel("Admin password").fill("admin-password");
    await page.getByRole("button", { name: "Unlock controls" }).click();

    await expect(page.getByRole("link", { name: "Moderation queue" })).toHaveAttribute("href", "/admin");
    await expect(page.getByRole("link", { name: "Source monitor" })).toHaveAttribute("href", "/admin/source-monitor");
    await expect(page.getByRole("link", { name: "Compile dossier" })).toHaveAttribute("href", "/admin/compile");
    await expectHealthyPage(page, problems);
  });

  test("report form submits to the success state", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");

    await page.getByLabel("Platform").selectOption("pc_steam");
    await page.getByLabel("Category").selectOption("performance");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByLabel("How often?").selectOption("often");
    await page.getByLabel("One-line summary").fill("FPS drops to 20 in open-field combat since 1.13");
    await page
      .getByLabel("What happened?")
      .fill("After patch 1.13, performance mode drops sharply during open-field combat and does not recover.");
    await page.getByText("Add technical detail Pearl Abyss can use").click();
    await page.getByLabel("Hardware (GPU, CPU, RAM)").fill("RTX 4060, Ryzen 5 7600, 32GB RAM");
    await page.getByRole("button", { name: "Submit report" }).click();

    await expect(page.getByRole("heading", { name: "Thanks for the clean signal." })).toBeVisible();
    await expect(page.getByText("Your report is in the moderation queue")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-success.png", { fullPage: true });
  });

  test("local save import fills visible technical fields without uploading raw files", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");
    const saveFolder = testInfo.outputPath("save-folder");
    await mkdir(saveFolder, { recursive: true });
    await writeFile(path.join(saveFolder, "user_engine_option_save.xml"), settingsXml);

    await page.setInputFiles("#save_import", saveFolder);
    await page.getByText("Add technical detail Pearl Abyss can use").click();

    await expect(page.getByText("1 local file inspected in this browser.")).toBeVisible();
    await expect(page.getByText("Raw files are not uploaded").first()).toBeVisible();
    await expect(page.getByLabel("Graphics mode / FPS setting")).toHaveValue(
      "NVIDIA DLSS 4.0 / AA / Frame Generation on / VSync off / HDR on",
    );
    await expect(page.getByLabel("Troubleshooting you tried")).toHaveValue(/settings XML parsed/);
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-import.png", { fullPage: true });
  });
});
