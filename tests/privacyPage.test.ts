import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const privacySource = readFileSync(path.join(process.cwd(), "src", "app", "privacy", "page.tsx"), "utf8");
const chromeSource = readFileSync(
  path.join(process.cwd(), "src", "components", "newspaper", "NewspaperShell.tsx"),
  "utf8",
);

describe("public privacy note", () => {
  it("is a short public page, not a dump of the repository policy", () => {
    expect(privacySource).toContain("No accounts");
    expect(privacySource).toContain("No email field");
    expect(privacySource).toContain("No ads or trackers");
    expect(privacySource).toContain("No raw IP storage");
    expect(privacySource).toContain("Reports stay private");
    expect(privacySource).toContain("docs/PRIVACY.md");
    expect(privacySource).toContain("SOURCE_URL");
    expect(privacySource).toContain('href="/about#privacy"');
    expect(privacySource).not.toMatch(/analytics\.js|gtag|plausible|umami/i);
  });

  it("keeps the footer Privacy link on the public page", () => {
    expect(chromeSource).toContain('href="/privacy"');
    expect(chromeSource).not.toContain("/about#privacy");
  });
});
