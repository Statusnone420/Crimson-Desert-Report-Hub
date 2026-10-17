import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("keeps the owner's handle out of public source, static assets, and build metadata", () => {
  const textFile = /\.(?:[cm]?[jt]sx?|json|xml|txt|svg|html|webmanifest|css|map)$|security\.txt$/i;
  const files = ["next.config.ts", "package.json", ...["src", "public"].flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && textFile.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  )];
  const exposed = files.filter((file) => /statusnone/i.test(readFileSync(file, "utf8")));
  expect(exposed).toEqual([]);
});
