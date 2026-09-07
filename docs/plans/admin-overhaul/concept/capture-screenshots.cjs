#!/usr/bin/env node
/**
 * Capture concept screenshots and run layout checks.
 * Reads local files only. Does not start the app or call a network API.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const dir = __dirname;
const shots = path.join(dir, "screenshots");
const html = pathToFileURL(path.join(dir, "index.html")).href;
const log = [];

function note(line) {
  log.push(line);
  console.log(line);
}

async function shot(page, file) {
  const dest = path.join(shots, file);
  await page.screenshot({ path: dest, fullPage: false, animations: "disabled" });
  const stat = fs.statSync(dest);
  note("screenshot " + file + " " + stat.size + " bytes");
}

async function openState(page, hash) {
  await page.goto(html + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#main");
  await page.waitForTimeout(80);
}

async function overflowReport(page, label) {
  const data = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = [];
    const all = document.body.querySelectorAll("*");
    const limit = doc.clientWidth;
    for (const el of all) {
      if (el.scrollWidth > limit + 1) {
        overflowing.push({
          tag: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""),
          scrollWidth: el.scrollWidth,
          client: limit,
        });
        if (overflowing.length >= 8) break;
      }
    }
    return {
      innerWidth: window.innerWidth,
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      overflowing,
    };
  });
  const delta = data.scrollWidth - data.clientWidth;
  note(
    label +
      ": inner=" +
      data.innerWidth +
      " client=" +
      data.clientWidth +
      " scroll=" +
      data.scrollWidth +
      " delta=" +
      delta +
      (data.overflowing.length ? " overflowEls=" + JSON.stringify(data.overflowing) : " no-element-overflow"),
  );
  return data;
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  const page = await browser.newPage();

  const states = [
    { file: "overview-normal", hash: "#view=overview&scenario=normal&theme=THEME" },
    { file: "review-claim", hash: "#view=review&scenario=normal&theme=THEME&item=claim-horse&pane=detail" },
    { file: "overview-empty", hash: "#view=overview&scenario=empty&theme=THEME" },
    { file: "review-failed-save", hash: "#view=review&scenario=failed-save&theme=THEME&item=rpt-skill&pane=detail" },
  ];

  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const spec of states) {
      await openState(page, spec.hash.replace("THEME", theme));
      await shot(page, "desktop-" + theme + "-" + spec.file + ".png");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const spec of states) {
      await openState(page, spec.hash.replace("THEME", theme));
      await shot(page, "mobile-" + theme + "-" + spec.file + ".png");
    }
  }

  note("--- extras ---");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openState(page, "#view=overview&scenario=unavailable&theme=light");
  await shot(page, "desktop-light-overview-unavailable.png");
  await openState(page, "#view=overview&scenario=ai-blocked&theme=light");
  await shot(page, "desktop-light-overview-ai-blocked.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=queue");
  await shot(page, "mobile-light-review-queue.png");

  note("--- 320px overflow ---");
  await page.setViewportSize({ width: 320, height: 844 });
  await openState(page, "#view=overview&scenario=normal&theme=light");
  const ov320 = await overflowReport(page, "320 overview-normal light");
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=detail");
  const rv320 = await overflowReport(page, "320 review-claim detail light");
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=queue");
  const q320 = await overflowReport(page, "320 review-queue light");

  note("--- 720px (~200% of 1440 CSS width) ---");
  await page.setViewportSize({ width: 720, height: 1100 });
  await openState(page, "#view=overview&scenario=normal&theme=light");
  const ov720 = await overflowReport(page, "720 overview-normal light");
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=detail");
  const rv720 = await overflowReport(page, "720 review-claim detail light");

  await page.setViewportSize({ width: 1440, height: 1100 });
  await openState(page, "#view=overview&scenario=normal&theme=light");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const zOverview = await overflowReport(page, "200% overview-normal light");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=detail");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const zReview = await overflowReport(page, "200% review-claim light");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });

  note("--- keyboard ---");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openState(page, "#view=overview&scenario=normal&theme=light");
  const order = [];
  for (let i = 0; i < 18; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute("aria-label") || el.id || "").replace(/\s+/g, " ").trim().slice(0, 80),
        className: String(el.className || "").slice(0, 60),
      };
    });
    order.push(info);
  }
  note("tab-order " + JSON.stringify(order));
  const skip = await page.evaluate(() => {
    const link = document.querySelector(".skip-link");
    link.focus();
    const style = getComputedStyle(link);
    return { top: style.top, focusTag: document.activeElement.className };
  });
  note("skip-link-focus " + JSON.stringify(skip));

  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=detail");
  await page.locator(".q-item").first().focus();
  await page.keyboard.press("Enter");
  const afterEnter = await page.evaluate(() => document.querySelector("#item-title") && document.querySelector("#item-title").textContent);
  note("queue-enter-title " + JSON.stringify(afterEnter));

  await page.locator('[data-decide="confirm"]').focus();
  const confirmFocused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-decide"));
  note("confirm-focus " + confirmFocused);

  note("--- reduced motion ---");
  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.setViewportSize({ width: 1440, height: 1100 });
  await reduced.goto(html + "#view=overview&scenario=normal&theme=light", { waitUntil: "domcontentloaded" });
  const motion = await reduced.evaluate(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const btn = document.querySelector(".chip");
    const cs = btn ? getComputedStyle(btn) : null;
    return {
      mq,
      transition: cs ? cs.transitionDuration : null,
      animation: cs ? cs.animationName : null,
    };
  });
  note("reduced-motion " + JSON.stringify(motion));
  await reduced.close();

  note("--- interaction: failed-save keeps excerpt ---");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openState(page, "#view=review&scenario=failed-save&theme=light&item=rpt-skill&pane=detail");
  const before = await page.inputValue("#excerpt");
  const banner = await page.locator(".banner").first().innerText();
  await page.fill("#excerpt", before + " (typed after error)");
  const kept = await page.inputValue("#excerpt");
  note("failed-save excerpt-before=" + JSON.stringify(before));
  note("failed-save banner=" + JSON.stringify(banner.slice(0, 160)));
  note("failed-save excerpt-after-type=" + JSON.stringify(kept));
  await page.locator('[data-decide="approved"]').click();
  const toast = await page.locator(".toast").innerText().catch(() => "");
  const excerptAfter = await page.evaluate(() => {
    const el = document.getElementById("excerpt");
    return el ? el.value : "no-excerpt-on-next-item";
  });
  note("failed-save after-approve toast=" + JSON.stringify(toast));
  note("failed-save next-excerpt-field=" + JSON.stringify(excerptAfter));

  note("--- interaction: confirm keeps queue ---");
  await openState(page, "#view=review&scenario=normal&theme=light&item=claim-horse&pane=detail");
  await page.locator('[data-decide="confirm"]').click();
  const queueText = await page.locator(".queue").innerText();
  note("after-confirm queue-has-claim=" + String(queueText.indexOf("Horse stride") >= 0));
  note("after-confirm queue-has-kept=" + String(queueText.indexOf("Kept in queue") >= 0 || queueText.indexOf("Decided") >= 0));

  await browser.close();

  const overflowOk =
    ov320.scrollWidth - ov320.clientWidth <= 1 &&
    rv320.scrollWidth - rv320.clientWidth <= 8 &&
    q320.scrollWidth - q320.clientWidth <= 1;

  note("--- summary ---");
  note("320px overflow within 8px: " + overflowOk);
  note("720px overview delta=" + (ov720.scrollWidth - ov720.clientWidth));
  note("720px review delta=" + (rv720.scrollWidth - rv720.clientWidth));
  note("200% CSS-zoom overview delta=" + (zOverview.scrollWidth - zOverview.clientWidth));
  note("200% CSS-zoom review delta=" + (zReview.scrollWidth - zReview.clientWidth));

  fs.writeFileSync(path.join(dir, "capture-log.txt"), log.join("\n") + "\n");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
