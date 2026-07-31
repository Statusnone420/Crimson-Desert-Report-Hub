import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildMemorySearchQueries } from "@/lib/automation/memory";
import { tavilyExtract } from "@/lib/automation/search";

/**
 * The authenticated Reddit API is retired. Reddit itself is not: the scanner
 * still discovers Reddit threads through Tavily, still rewrites them to
 * old.reddit.com for extraction, and still trusts reddit.com as a domain.
 *
 * These are structural proofs — they read the shipped source rather than a
 * mock, so re-adding an OAuth call or a credential read fails here even if
 * every behavioral test still passes.
 */

const SRC_ROOT = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const PRODUCTION_SOURCES = sourceFiles(SRC_ROOT).map((file) => ({
  file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
  text: readFileSync(file, "utf8"),
}));

describe("Reddit API retirement", () => {
  it("ships no reddit.server module", () => {
    expect(existsSync(path.join(SRC_ROOT, "lib", "reddit.server.ts"))).toBe(false);
  });

  it("has no production module importing reddit.server", () => {
    const importers = PRODUCTION_SOURCES.filter((source) => /reddit\.server/.test(source.text)).map(
      (source) => source.file,
    );
    expect(importers).toEqual([]);
  });

  it("has no runtime path reading Reddit credentials", () => {
    const readers = PRODUCTION_SOURCES.filter((source) =>
      /REDDIT_CLIENT_ID|REDDIT_CLIENT_SECRET|REDDIT_USER_AGENT/.test(source.text),
    ).map((source) => source.file);
    expect(readers).toEqual([]);
  });

  it("has no OAuth token or subreddit-listing call left anywhere in src", () => {
    const callers = PRODUCTION_SOURCES.filter((source) =>
      /getRedditToken|fetchNewPosts|oauth\.reddit\.com|reddit\.com\/api\/v1\/access_token/.test(source.text),
    ).map((source) => source.file);
    expect(callers).toEqual([]);
  });

  it("emits no reddit_disabled skip and no Reddit run-display messaging", () => {
    const runSource = readFileSync(path.join(SRC_ROOT, "lib", "automation", "run.ts"), "utf8");
    const displaySource = readFileSync(
      path.join(SRC_ROOT, "lib", "automation", "runDisplay.ts"),
      "utf8",
    );
    expect(runSource).not.toContain("reddit_disabled");
    expect(displaySource).not.toContain("reddit_disabled");
    // The remaining Reddit mentions are about the Tavily reader refusing
    // reddit.com, which is still live; the "disabled source" wording is gone.
    expect(displaySource).not.toContain("Reddit disabled");
    expect(displaySource).not.toContain("Reddit source is off");
  });

  it("seeds no reddit_disabled skip into preview runs", () => {
    // Fixtures outlive the code they imitate: a seeded skip the engine can no
    // longer emit would put a dead "Reddit disabled" row back on the operator
    // console every preview. The historical reddit_posts_seen field stays.
    const seedSource = readFileSync(
      path.join(process.cwd(), "scripts", "generate-preview-seed.mjs"),
      "utf8",
    );
    expect(seedSource).not.toContain("reddit_disabled");
  });

  it("keeps Tavily Reddit discovery in the query pack", () => {
    const queries = buildMemorySearchQueries(20, "1.14.00", "broad_discovery", { rotationOffset: 0 });
    expect(queries.some((query) => query.includes("site:reddit.com"))).toBe(true);
  });

  it("keeps the old.reddit.com extraction rewrite", async () => {
    const requests: { url: string; init: { body?: unknown } }[] = [];
    const fetcher = vi.fn(async (url: string, init: { body?: unknown }) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ raw_content: "Players report constant stutter." }] }),
      };
    });

    await tavilyExtract("https://www.reddit.com/r/CrimsonDesert/comments/abc/fps_drops/?utm_source=search", {
      env: { TAVILY_API_KEY: "tavily-key" },
      fetcher,
    });

    const body = JSON.parse(String(requests[0].init.body)) as { urls: string[] };
    expect(body.urls).toEqual(["https://old.reddit.com/r/CrimsonDesert/comments/abc/fps_drops/"]);
  });
});
