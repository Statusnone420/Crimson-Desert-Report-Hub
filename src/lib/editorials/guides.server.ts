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

// A Windows checkout may hold CRLF; the prompt is the same bytes everywhere, so caching matches.
function read(name: string): string {
  return readFileSync(path.join(GUIDE_DIRECTORY, name), "utf8").replace(/\r\n/g, "\n");
}

export function readColumnGuides(): ColumnGuides {
  cached ??= { style: read("hubDeskStyle.md"), slop: read("avoidAiSlop.md") };
  return cached;
}
