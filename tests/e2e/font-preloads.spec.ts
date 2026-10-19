import { expect, test, type Page } from "@playwright/test";

// The file name without its build hash, size-adjust and preload markers.
function fontName(url: string) {
  const match = /\/media\/([a-z0-9_]+)(?:-s)?(?:\.p)?\.[^./]+\.woff2$/.exec(url);
  if (!match) throw new Error(`Unexpected font URL: ${url}`);
  return match[1];
}

// The first family name in a CSS font-family list, without quotes.
async function firstFamily(page: Page, variable: string) {
  const value = await page.locator("html").evaluate((html, name) => getComputedStyle(html).getPropertyValue(name), variable);
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

test("pages preload only the Latin font files", async ({ page }) => {
  const response = await page.goto("/");
  const header = response?.headers().link ?? "";
  const fromHeader = [...header.matchAll(/<([^>]+\.woff2)>;[^,]*rel=preload/g)].map((match) => match[1]);
  const fromHead = await page.locator('link[rel="preload"][as="font"]').evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  const preloaded = [...new Set([...fromHeader, ...fromHead].map(fontName))].sort();
  expect(preloaded).toEqual([
    "ibm_plex_mono_400_latin",
    "ibm_plex_mono_500_latin",
    "instrument_sans_latin",
    "instrument_serif_400_italic_latin",
    "instrument_serif_400_latin",
  ]);
});

test("each face keeps every subset in one family, with Latin last", async ({ page }) => {
  await page.goto("/");
  const families = {
    sans: await firstFamily(page, "--font-instrument-sans"),
    serif: await firstFamily(page, "--font-instrument-serif"),
    mono: await firstFamily(page, "--font-plex-mono"),
  };
  // Rules that share family, weight and style form one face. The browser tries
  // the last rule first, so Latin wins wherever the files overlap. The dev
  // overlay adds its own faces, so only the site's families count.
  const faces = await page.evaluate((siteFamilies) => {
    const grouped: Record<string, string[]> = {};
    for (const sheet of [...document.styleSheets]) {
      for (const rule of [...sheet.cssRules]) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "");
        const url = /url\(["']?([^"')]+\.woff2)/.exec(rule.style.getPropertyValue("src"))?.[1];
        if (!siteFamilies.includes(family) || !url) continue;
        const key = `${family}|${rule.style.getPropertyValue("font-weight")}|${rule.style.getPropertyValue("font-style")}`;
        (grouped[key] ??= []).push(url);
      }
    }
    return grouped;
  }, Object.values(families));
  const names = Object.fromEntries(Object.entries(faces).map(([key, urls]) => [key, urls.map(fontName)]));
  expect(names).toEqual({
    [`${families.sans}|400 700|normal`]: ["instrument_sans_latin_ext", "instrument_sans_latin"],
    [`${families.serif}|400|italic`]: ["instrument_serif_400_italic_latin_ext", "instrument_serif_400_italic_latin"],
    [`${families.serif}|400|normal`]: ["instrument_serif_400_latin_ext", "instrument_serif_400_latin"],
    [`${families.mono}|400|normal`]: [
      "ibm_plex_mono_400_cyrillic_ext",
      "ibm_plex_mono_400_cyrillic",
      "ibm_plex_mono_400_vietnamese",
      "ibm_plex_mono_400_latin_ext",
      "ibm_plex_mono_400_latin",
    ],
    [`${families.mono}|500|normal`]: [
      "ibm_plex_mono_500_cyrillic_ext",
      "ibm_plex_mono_500_cyrillic",
      "ibm_plex_mono_500_vietnamese",
      "ibm_plex_mono_500_latin_ext",
      "ibm_plex_mono_500_latin",
    ],
  });
});
