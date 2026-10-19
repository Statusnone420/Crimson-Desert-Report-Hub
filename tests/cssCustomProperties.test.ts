import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// A var() without a fallback must name a custom property that src defines. An
// undefined name makes the whole declaration invalid, and the browser drops it
// without a warning: that hid --mono and --dispatch-link. A name that only
// Tailwind's default theme defines swaps in Tailwind's value instead: that gave
// two operator headings Georgia (--font-serif) instead of the site's serif.
// Definitions count from CSS (--name: value), style objects and setProperty calls
// in TS or TSX, and next/font's `variable` option.
const definition = /(?<![\w-])(--[\w-]+)\s*:|["'](--[\w-]+)["']\s*:|variable:\s*["'](--[\w-]+)["']|setProperty\(\s*["'](--[\w-]+)["']/g;
const useWithoutFallback = /var\(\s*(--[\w-]+)\s*\)/g;

it("defines every custom property that a var() without a fallback uses", () => {
  const files = readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:css|tsx?)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
  const defined = new Set<string>();
  const uses: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(definition)) defined.add(match.slice(1).find(Boolean)!);
    for (const match of text.matchAll(useWithoutFallback)) uses.push(`${match[1]} in ${file}`);
  }
  expect(defined.size).toBeGreaterThan(50);
  expect(uses.filter((use) => !defined.has(use.split(" ")[0]))).toEqual([]);
});
