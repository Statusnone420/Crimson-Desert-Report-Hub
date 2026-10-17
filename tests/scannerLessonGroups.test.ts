import { describe, expect, it } from "vitest";
import {
  groupScannerLessons,
  lessonRuleDomain,
  shortLessonTarget,
  summarizeScannerLessons,
} from "@/lib/scannerLessonGroups";

function rule(action: string, scope_type: string, scope_value: string) {
  return { action, scope_type, scope_value };
}

describe("lessonRuleDomain", () => {
  it("reads the domain out of every scope shape", () => {
    expect(lessonRuleDomain(rule("block", "source_domain", "thecrimson.com"))).toBe("thecrimson.com");
    expect(lessonRuleDomain(rule("block", "source_path", "reddit.com/r/palworld"))).toBe("reddit.com");
    expect(
      lessonRuleDomain(rule("block", "exact_url", "https://www.reddit.com/r/CrimsonDesert/comments/1v3kohs/bought")),
    ).toBe("reddit.com");
  });

  it("falls back to the raw value rather than guessing", () => {
    // A stored value that parses as no URL and no domain must not be filed
    // under someone else's domain.
    expect(lessonRuleDomain(rule("block", "exact_url", "not a url at all"))).toBe("not a url at all");
    expect(lessonRuleDomain(rule("block", "exact_url", ""))).toBe("unknown");
  });
});

describe("groupScannerLessons", () => {
  it("collapses one domain's rules into a single group without losing any", () => {
    // The real shape of the wall: the same Steam thread taught six times, once
    // per language, because the language query param survives canonicalization.
    const rules = [
      "https://steamcommunity.com/app/3321460/discussions/0/805720165777101166?l=hungarian",
      "https://steamcommunity.com/app/3321460/discussions/0/805720165777101166?l=thai",
      "https://steamcommunity.com/app/3321460/discussions/0/805720165777101166?l=finnish",
      "https://steamcommunity.com/app/3321460/discussions/0/805720165777101166?l=swedish",
    ].map((url) => rule("block", "exact_url", url));

    const groups = groupScannerLessons(rules);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("steamcommunity.com");
    expect(groups[0].rules).toHaveLength(4);
    // Every rule survives grouping — this is a heading, not a merge.
    expect(groups[0].rules.map((r) => r.scope_value)).toEqual(rules.map((r) => r.scope_value));
  });

  it("keeps blocks and keeps on the same domain apart", () => {
    const groups = groupScannerLessons([
      rule("block", "exact_url", "https://reddit.com/r/CrimsonDesert/comments/a"),
      rule("allow", "exact_url", "https://reddit.com/r/CrimsonDesert/comments/b"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.action)).toEqual(["block", "allow"]);
  });

  it("keeps scope types apart so a domain rule never hides inside a URL group", () => {
    const groups = groupScannerLessons([
      rule("block", "exact_url", "https://reddit.com/r/CrimsonDesert/comments/a"),
      rule("block", "source_path", "reddit.com/r/palworld"),
      rule("block", "source_domain", "reddit.com"),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.scopeType)).toEqual(["exact_url", "source_path", "source_domain"]);
  });

  it("preserves first-seen order so the newest decision stays on top", () => {
    const groups = groupScannerLessons([
      rule("block", "exact_url", "https://zamin.uz/a"),
      rule("block", "exact_url", "https://reddit.com/b"),
      rule("block", "exact_url", "https://zamin.uz/c"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["zamin.uz", "reddit.com"]);
  });

  it("returns nothing for no rules", () => {
    expect(groupScannerLessons([])).toEqual([]);
  });
});

describe("summarizeScannerLessons", () => {
  it("counts the ledger the way the header states it", () => {
    const summary = summarizeScannerLessons([
      rule("block", "exact_url", "https://reddit.com/a"),
      rule("block", "exact_url", "https://reddit.com/b"),
      rule("block", "source_domain", "adobe.com"),
      rule("allow", "exact_url", "https://reddit.com/c"),
    ]);

    expect(summary).toEqual({ total: 4, blocks: 3, keeps: 1, domains: 2 });
  });

  it("never invents a total from an empty ledger", () => {
    expect(summarizeScannerLessons([])).toEqual({ total: 0, blocks: 0, keeps: 0, domains: 0 });
  });
});

describe("shortLessonTarget", () => {
  it("keeps the tail, which is the part that differs", () => {
    const long = rule(
      "block",
      "exact_url",
      "https://www.reddit.com/r/CrimsonDesert/comments/1v3kohs/bought_the_game_and_it_is_great",
    );

    const short = shortLessonTarget(long, 30);

    expect(short.length).toBeLessThanOrEqual(30);
    expect(short.startsWith("…")).toBe(true);
    expect(short.endsWith("great")).toBe(true);
  });

  it("leaves a short target alone apart from the scheme", () => {
    expect(shortLessonTarget(rule("block", "source_domain", "adobe.com"))).toBe("adobe.com");
    expect(shortLessonTarget(rule("block", "exact_url", "https://adobe.com/x"))).toBe("adobe.com/x");
  });
});
