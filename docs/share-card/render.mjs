// Renders the share-card mock to PNG evidence. Reproducible: the committed
// PNGs must always equal `node docs/share-card/render.mjs` output.
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const cardUrl = pathToFileURL(path.join(here, "share-card.html")).href;
const patchUrl = pathToFileURL(path.join(here, "patch-2-02-00.html")).href;
const sizesUrl = pathToFileURL(path.join(here, "evidence-sizes.html")).href;

const browser = await chromium.launch();

async function shoot(url, { width, height, scale, out, fullPage = false }) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  await page.screenshot({ path: path.join(here, out), fullPage });
  await page.close();
  console.log(`rendered ${out}`);
}

// The artifact itself: exact OG pixel size.
await shoot(cardUrl, { width: 1200, height: 630, scale: 1, out: "preview-1200x630.png" });
await shoot(patchUrl, { width: 1200, height: 630, scale: 1, out: "preview-patch-2-02-00.png" });
// Evidence sheet: same card at full, social-card, and Google-thumbnail scale.
await shoot(sizesUrl, { width: 1360, height: 100, scale: 2, out: "preview-sizes.png", fullPage: true });

await browser.close();

// Ship both crawler images from the same pixels. The file convention updates
// their content hashes while keeping the existing image endpoints available.
await copyFile(path.join(here, "preview-1200x630.png"), path.join(here, "../../src/app/opengraph-image.png"));
await copyFile(path.join(here, "preview-1200x630.png"), path.join(here, "../../src/app/twitter-image.png"));
await mkdir(path.join(here, "../../public/share"), { recursive: true });
await copyFile(path.join(here, "preview-patch-2-02-00.png"), path.join(here, "../../public/share/patch-2-02-00.png"));
