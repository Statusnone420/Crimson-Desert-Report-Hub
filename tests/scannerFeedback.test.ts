import { describe, expect, it } from "vitest";
import {
  matchScannerFeedbackRule,
  scannerRuleScopeValue,
  sourcePathScopeValue,
  type ScannerFeedbackRule,
} from "@/lib/automation/feedback";

function rule(overrides: Partial<ScannerFeedbackRule> = {}): ScannerFeedbackRule {
  return {
    id: "rule-exact-block",
    action: "block",
    decision: "off_topic",
    scopeType: "exact_url",
    scopeValue: "https://www.reddit.com/r/protonmail/comments/abc/any_plans_for_mcp",
    createdAt: "2026-07-22T12:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("scanner feedback rules", () => {
  it("normalizes Reddit rules to an explicit subreddit scope", () => {
    expect(sourcePathScopeValue("https://old.reddit.com/r/ProtonMail/comments/abc/post/?utm_source=x")).toBe(
      "reddit.com/r/protonmail",
    );
  });

  it("derives exact, path, and domain values from the candidate", () => {
    const candidate = {
      url: "https://www.reddit.com/r/ProtonMail/comments/abc/post/?utm_source=x",
      sourceDomain: "www.reddit.com",
    };
    expect(scannerRuleScopeValue("exact_url", candidate)).toBe(
      "https://www.reddit.com/r/ProtonMail/comments/abc/post",
    );
    expect(scannerRuleScopeValue("source_path", candidate)).toBe("reddit.com/r/protonmail");
    expect(scannerRuleScopeValue("source_domain", candidate)).toBe("reddit.com");
  });

  it("shows and stores one registrable scope for multi-part domains", () => {
    const candidate = {
      url: "https://support.example.co.uk/help/crashes/article",
      sourceDomain: "support.example.co.uk",
    };
    expect(scannerRuleScopeValue("source_path", candidate)).toBe("example.co.uk/help/crashes");
    expect(scannerRuleScopeValue("source_domain", candidate)).toBe("example.co.uk");
  });

  it("matches an exact URL block deterministically", () => {
    const candidate = {
      url: "https://www.reddit.com/r/protonmail/comments/abc/any_plans_for_mcp?utm_medium=web",
      sourceDomain: "reddit.com",
    };
    expect(matchScannerFeedbackRule(candidate, [rule()])).toMatchObject({
      action: "block",
      rule: { id: "rule-exact-block", decision: "off_topic" },
    });
  });

  it("keeps a rule recorded before Steam parameters were droppable", () => {
    // The stored value was canonical on the day it was written; the candidate
    // is canonical today. Without re-canonicalizing the rule on read, every
    // Steam lesson taught before this change would quietly stop working and the
    // rejected thread would come back.
    const storedBeforeTheChange = rule({
      id: "steam-exact-block",
      scopeValue: "https://steamcommunity.com/app/3321460/discussions/0/8057?l=english",
    });
    const candidate = {
      url: "https://steamcommunity.com/app/3321460/discussions/0/8057?l=koreana",
      sourceDomain: "steamcommunity.com",
    };

    expect(matchScannerFeedbackRule(candidate, [storedBeforeTheChange])).toMatchObject({
      action: "block",
      rule: { id: "steam-exact-block" },
    });
  });

  it("lets a newer exact allow supersede an older exact block", () => {
    const candidate = {
      url: "https://www.reddit.com/r/protonmail/comments/abc/any_plans_for_mcp",
      sourceDomain: "reddit.com",
    };
    const allow = rule({
      id: "rule-exact-allow",
      action: "allow",
      decision: "relevant",
      createdAt: "2026-07-22T13:00:00.000Z",
    });
    expect(matchScannerFeedbackRule(candidate, [rule(), allow])).toMatchObject({
      action: "allow",
      rule: { id: "rule-exact-allow" },
    });
  });

  it("prefers an exact decision over a broader domain rule", () => {
    const candidate = {
      url: "https://www.reddit.com/r/crimsondesert/comments/game_bug",
      sourceDomain: "reddit.com",
    };
    const domainBlock = rule({
      id: "domain-block",
      scopeType: "source_domain",
      scopeValue: "reddit.com",
      createdAt: "2026-07-22T14:00:00.000Z",
    });
    const exactAllow = rule({
      id: "exact-allow",
      action: "allow",
      decision: "relevant",
      scopeValue: candidate.url,
      createdAt: "2026-07-22T12:00:00.000Z",
    });
    expect(matchScannerFeedbackRule(candidate, [domainBlock, exactAllow])).toMatchObject({
      action: "allow",
      rule: { id: "exact-allow" },
    });
  });

  it("ignores expired and undone rules", () => {
    const candidate = {
      url: "https://www.reddit.com/r/protonmail/comments/abc/any_plans_for_mcp",
      sourceDomain: "reddit.com",
    };
    expect(
      matchScannerFeedbackRule(
        candidate,
        [
          rule({ expiresAt: "2026-07-22T11:59:00.000Z" }),
          rule({ id: "revoked", revokedAt: "2026-07-22T11:00:00.000Z" }),
        ],
        new Date("2026-07-22T12:00:00.000Z"),
      ),
    ).toBeNull();
  });
});
