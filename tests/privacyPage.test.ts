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
    expect(privacySource).toContain("No ads or trackers");
    expect(privacySource).toContain("No raw IP storage");
    expect(privacySource).toContain("One current response");
    expect(privacySource).toContain("Turnstile");
    expect(privacySource).toContain("Historical written reports");
    expect(privacySource).toContain("independent fan site");
    expect(privacySource).not.toContain("docs/PRIVACY.md");
    expect(privacySource).not.toContain("SOURCE_URL");
    expect(privacySource).toContain('href="/about#privacy"');
    expect(privacySource).not.toMatch(/analytics\.js|gtag|plausible|umami/i);
  });

  it("discloses what a private problem report keeps", () => {
    const aboutSource = readFileSync(path.join(process.cwd(), "src", "app", "about", "page.tsx"), "utf8");
    expect(privacySource).toContain("Private problem reports");
    expect(privacySource).toContain("an email address if you provide one");
    expect(privacySource).toContain("nothing is deleted automatically");
    for (const source of [privacySource, aboutSource]) {
      expect(source).not.toMatch(/or email field|No accounts, email/);
    }
  });

  it("links Cloudflare's Turnstile Privacy Addendum, which invisible mode requires", () => {
    expect(privacySource).toContain('href="https://www.cloudflare.com/turnstile-privacy-policy/"');
    expect(privacySource).toContain("Turnstile Privacy Addendum");
  });

  it("keeps the footer Privacy link on the public page", () => {
    expect(chromeSource).toContain('href="/privacy"');
    expect(chromeSource).not.toContain("/about#privacy");
  });
});
