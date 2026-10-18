import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ColumnGuides } from "@/lib/editorials/prompts";

/**
 * The style guide and the pre-publish checklist live in one committed copy each, read
 * at run time. next.config.ts traces both files into the functions that call this.
 */
const GUIDE_DIRECTORY = path.join(process.cwd(), "src", "lib", "editorials");
let cached: ColumnGuides | null = null;

export function readColumnGuides(): ColumnGuides {
  cached ??= {
    style: readFileSync(path.join(GUIDE_DIRECTORY, "pywelDeskStyle.md"), "utf8"),
    slop: readFileSync(path.join(GUIDE_DIRECTORY, "avoidAiSlop.md"), "utf8"),
  };
  return cached;
}
