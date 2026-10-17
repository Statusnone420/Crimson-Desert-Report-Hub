import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

const STANDARD_VIEWPORT = { width: 1440, height: 1100 };
const WIDE_VIEWPORT = { width: 2560, height: 1100 };
const views = ["overview", "reports", "claims", "scanner", "videos", "dossiers", "settings"] as const;
const viewHeadings: Record<(typeof views)[number], string> = {
  overview: "Overview",
  reports: "Reports",
  claims: "Claim review",
  scanner: "Scanner workspace",
  videos: "Video review",
  dossiers: "Compile dossier",
  settings: "Settings & tools",
};

function workspacePath(view: (typeof views)[number]) {
  return view === "overview" ? "/operator" : `/operator?view=${view}`;
}

test("every operator view uses the desktop viewport without horizontal overflow", async ({ page }) => {
  await signInAsAdmin(page);
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const view of views) {
        const widths: number[] = [];
        for (const viewport of [STANDARD_VIEWPORT, WIDE_VIEWPORT]) {
          await page.setViewportSize(viewport);
          await page.goto(workspacePath(view));
          await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
          await expect(page.locator(".operator-workspace")).toBeVisible();
          await expect(page.getByRole("heading", { name: viewHeadings[view] })).toBeVisible();
          const dimensions = await page.locator(".operator-workspace").evaluate((root) => {
            const main = document.querySelector(".workspace-main");
            return {
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              rootWidth: root.getBoundingClientRect().width,
              rootHeight: root.getBoundingClientRect().height,
              documentWidth: document.documentElement.scrollWidth,
              rootScrollWidth: root.scrollWidth,
              mainWidth: main?.getBoundingClientRect().width ?? 0,
            };
          });
          expect(dimensions.rootWidth).toBe(dimensions.viewportWidth);
          expect(dimensions.rootHeight).toBeGreaterThanOrEqual(dimensions.viewportHeight);
          expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
          expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
          widths.push(dimensions.mainWidth);
        }
        expect(widths[1], `${view} ${theme} content should expand on a wide desktop`).toBeGreaterThan(widths[0]);
      }
    }
  } finally {
    await page.setViewportSize(STANDARD_VIEWPORT);
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  }
});
