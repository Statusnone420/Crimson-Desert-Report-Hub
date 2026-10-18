import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// The handle may appear in exactly two declarations, each once: the footer's AGPL
// source link in src/lib/site.ts, and the column's editor credit in
// src/lib/editorials/content.ts (owner decision, 2026-10-18). The credit is plain
// text: never a link, and its JSON-LD Person has no url or sameAs. A copy anywhere
// else still fails.
const ALLOWED = [
  { file: path.join("src", "lib", "site.ts"), declaration: 'export const SOURCE_URL = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";' },
  { file: path.join("src", "lib", "editorials", "content.ts"), declaration: 'export const COLUMN_EDITOR = "Statusnone";' },
];

it("keeps the owner's handle out of public source, static assets, and build metadata, apart from the source link and the column credit", () => {
  const textFile = /\.(?:[cm]?[jt]sx?|json|xml|txt|svg|html|webmanifest|css|map)$|security\.txt$/i;
  const files = ["next.config.ts", "package.json", ...["src", "public"].flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && textFile.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )];
  for (const allowed of ALLOWED) expect(readFileSync(allowed.file, "utf8").split(allowed.declaration)).toHaveLength(2);
  const exposed = files.filter((file) => {
    const allowed = ALLOWED.find((item) => item.file === path.normalize(file));
    const text = readFileSync(file, "utf8");
    return /statusnone/i.test(allowed ? text.replace(allowed.declaration, "") : text);
  });
  expect(exposed).toEqual([]);
});
