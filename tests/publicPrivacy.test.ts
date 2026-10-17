import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// The footer's AGPL source link is the one place the handle may appear.
const SOURCE_URL = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";

it("keeps the owner's handle out of public source, static assets, and build metadata, apart from the source link", () => {
  const textFile = /\.(?:[cm]?[jt]sx?|json|xml|txt|svg|html|webmanifest|css|map)$|security\.txt$/i;
  const files = ["next.config.ts", "package.json", ...["src", "public"].flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && textFile.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )];
  const exposed = files.filter((file) => /statusnone/i.test(readFileSync(file, "utf8").replaceAll(SOURCE_URL, "")));
  expect(exposed).toEqual([]);
});
