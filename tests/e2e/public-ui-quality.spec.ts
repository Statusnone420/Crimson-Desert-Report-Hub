import { expect, test, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import nextConfig from "../../next.config";
import { SOURCE_URL } from "../../src/lib/site";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

// Cover each public page template, including authored articles, generated
// rundowns, historical patches, and the missing-page recovery path.
const routes = [
  "/", "/news", "/watch", "/patches", "/patches/1-13-01", "/issues",
  "/observatory", "/catch-up", "/about", "/privacy", "/contact",
  "/articles/charting-the-unknown", "/articles/charting-the-unknown-delay", "/articles/patch-2-02-00",
  "/articles/patch-2-03-00", "/articles/patch-1-13-01", "/admin/login", "/missing-public-page",
];

// A new public route must get a fixture in this sweep or an explicit redirect
// check. This prevents another page from silently falling outside the gate.
const redirects = {
  "/report": "/issues",
  "/scanner": "/observatory",
  "/patches/archive": "/patches#archive",
  "/topics/charting-the-unknown": "/articles/charting-the-unknown",
};
function publicPageTemplates(files: string[], pageExtensions = ["tsx", "ts", "jsx", "js"]) {
  const pageNames = new Set(pageExtensions.map((extension) => `page.${extension}`));
  return files
    .map((file) => file.replace(/\\/g, "/").split("/"))
    .filter((segments) => pageNames.has(segments[segments.length - 1]))
    .map((segments) => `/${segments.slice(0, -1).join("/")}`)
    .filter((route) => !/^\/(admin|operator)(\/|$)/.test(route) || route === "/admin/login");
}

test("page inventory discovers JavaScript and TypeScript pages on either platform", () => {
  const templates = publicPageTemplates([
    "page.js", "news/page.jsx", "patches/page.ts", "about/page.tsx",
    "contact\\page.js", "articles\\charting-the-unknown\\page.jsx",
    "admin/page.jsx", "operator/page.js", "admin/login/page.tsx",
    "guide/page.mdx", "news/layout.tsx", "news/homepage.tsx", "news/page.tsx.bak",
  ]);
  expect(templates).toEqual([
    "/", "/news", "/patches", "/about", "/contact",
    "/articles/charting-the-unknown", "/admin/login",
  ]);
});

test("page inventory respects configured extensions and ignores other files", () => {
  expect(publicPageTemplates([
    "page.jsx", "guide/page.mdx", "news\\page.custom.tsx",
    "disabled/page.js", "disabled/page.ts", "disabled/page.tsx",
    "guide/page.mdx.bak", "news/pageXcustomYtsx", "news/layout.jsx",
  ], ["jsx", "mdx", "custom.tsx"])).toEqual(["/", "/guide", "/news"]);
});

test("every public page template is included in the quality sweep", async () => {
  const root = path.join(process.cwd(), "src", "app");
  // Read extension overrides without invoking production-only service checks.
  const { pageExtensions } = await nextConfig(PHASE_DEVELOPMENT_SERVER);
  const templates = publicPageTemplates(readdirSync(root, { recursive: true, encoding: "utf8" }), pageExtensions);
  const covered = new Set([...routes, ...Object.keys(redirects), "/articles/[slug]", "/patches/[version]"]);
  expect(templates.filter((route) => !covered.has(route))).toEqual([]);
});

test("public aliases retain their reading destinations", async ({ request }) => {
  for (const [route, destination] of Object.entries(redirects)) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(response.headers().location).toBe(destination);
  }
});

async function expectInformationLayout(page: Page, route: string) {
  if (!["/about", "/privacy", "/contact"].includes(route)) return;
  const frame = await page.locator(".information-page").boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(frame).not.toBeNull();
  expect(main).not.toBeNull();
  expect(Math.abs((frame!.x - main!.x) - (main!.x + main!.width - frame!.x - frame!.width))).toBeLessThan(2);
  if (route === "/contact") {
    const reporting = await page.getByRole("region", { name: "Report a problem" }).boundingBox();
    const support = await page.getByRole("region", { name: "Game and account support" }).boundingBox();
    if (page.viewportSize()!.width >= 900) {
      expect(Math.abs(reporting!.y - support!.y)).toBeLessThan(2);
      expect(support!.x).toBeGreaterThan(reporting!.x + reporting!.width);
    } else {
      expect(support!.y).toBeGreaterThanOrEqual(reporting!.y + reporting!.height);
    }
  } else {
    const alignment = await page.locator(".method-registers__def").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).textAlign));
    expect(alignment.length).toBeGreaterThan(0);
    expect(alignment.every((value) => value === "left" || value === "start")).toBe(true);
  }
}

async function textContrastFailures(page: Page) {
  return page.evaluate(() => {
    type Color = [number, number, number, number];
    function color(value: string): Color | null {
      const parts = value.match(/[\d.]+/g)?.map(Number);
      if (!parts || parts.length < 3) return null;
      if (value.startsWith("color(srgb ")) return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts[3] ?? 1];
      if (value.startsWith("rgb")) return [parts[0], parts[1], parts[2], parts[3] ?? 1];
      return null;
    }
    function over(top: Color, bottom: Color): Color {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha)
        .concat(alpha) as Color;
    }
    function luminance(rgb: Color) {
      const [r, g, b] = rgb.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return r * .2126 + g * .7152 + b * .0722;
    }
    const failures: { text: string; selector: string; ratio: number; minimum: number; foreground: string }[] = [];
    let checked = 0;
    for (const element of document.querySelectorAll<HTMLElement>(".newspaper *")) {
      const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim();
      if (!text || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (element.closest('svg, script, style, [aria-hidden="true"], :disabled, [inert]')) continue;
      // Image captions need a visual check against the actual image pixels.
      // A flat-color DOM calculation cannot evaluate their shadow/scrim.
      if (element.closest("figcaption, .image-credit")) continue;
      const style = getComputedStyle(element);
      const foreground = color(style.color);
      if (!foreground) throw new Error(`Unsupported text color: ${style.color}`);
      let background: Color = [0, 0, 0, 0];
      let opacity = 1;
      let imageBackground = false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const current = getComputedStyle(node);
        opacity *= Number(current.opacity);
        if (background[3] < 1) {
          if (current.backgroundImage !== "none") imageBackground = true;
          const layer = color(current.backgroundColor);
          if (layer) background = over(background, layer);
        }
      }
      if (imageBackground || opacity < 1 || background[3] < 1) continue;
      checked++;
      const a = luminance(over(foreground, background));
      const b = luminance(background);
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const size = Number.parseFloat(style.fontSize);
      const minimum = size >= 24 || (size >= 18.6667 && Number.parseInt(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < minimum) failures.push({ text: text.slice(0, 100), selector: `${element.tagName.toLowerCase()}.${element.className}`, ratio: Math.round(ratio * 100) / 100, minimum, foreground: style.color });
    }
    return checked ? failures : [{ text: "No visible text was measured", selector: ".newspaper", ratio: 0, minimum: 4.5, foreground: "" }];
  });
}

for (const route of routes) {
  test(`public UI quality ${route}`, async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page, route === "/missing-public-page" ? new URL(route, testInfo.project.use.baseURL).href : undefined);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(route === "/missing-public-page" ? 404 : 200);
    // The AGPL source offer: every public page, the 404 included, links to the code.
    const source = page.getByRole("contentinfo").getByRole("link", { name: "Source code on GitHub", exact: true });
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute("href", SOURCE_URL);
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", /\bnoopener\b/);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const role of ["button", "link", "textbox", "searchbox", "combobox", "slider"] as const) {
      await expect(page.getByRole(role, { name: "", exact: true }), `${route}: unnamed ${role}`).toHaveCount(0);
    }
    await page.evaluate(() => document.fonts.ready);
    // The date replaces its server placeholder after hydration. Native details
    // must not change the HTML while React is still attaching to this render.
    await expect(page.getByTitle("Desk date · America/New_York", { exact: true }))
      .toHaveText(/\d{4}$/, { timeout: 30_000 });
    if (route === "/about") {
      for (const summary of await page.locator("main details > summary").all()) await summary.click();
    }
    const widths = testInfo.project.name === "mobile-chromium" ? [390, 320] : [1440, 768];
    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      // Resize without reloading so the gate also catches theme/navigation
      // style leakage and breakpoint changes in an already hydrated page.
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => textContrastFailures(page), { message: `${route}: ${theme}, ${width}px text contrast` }).toEqual([]);
        await expectHealthyPage(page, problems);
        await expect(page.locator("main img:not([alt])")).toHaveCount(0);
        await expectInformationLayout(page, route);
      }
    }
  });
}

test.describe("server-rendered reading", () => {
  test.use({ javaScriptEnabled: false });
  test("public content remains visible before JavaScript runs", async ({ page }) => {
    await page.goto("/contact", { waitUntil: "domcontentloaded" });
    await expect.poll(() => textContrastFailures(page)).toEqual([]);
    await expect(page.getByRole("heading", { name: "Report a problem", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pearl Abyss support", exact: true })).toBeVisible();
  });
});
