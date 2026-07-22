import { canonicalizeUrl } from "@/lib/automation/dedupe";
import { registrableDomain } from "@/lib/automation/domains";

export const SCANNER_DECISIONS = [
  "relevant",
  "off_topic",
  "wrong_patch",
  "not_issue_report",
  "duplicate",
] as const;

export const SCANNER_RULE_SCOPES = ["exact_url", "source_path", "source_domain"] as const;

export type ScannerDecision = (typeof SCANNER_DECISIONS)[number];
export type ScannerRuleScope = (typeof SCANNER_RULE_SCOPES)[number];
export type ScannerRuleAction = "allow" | "block";

export type ScannerFeedbackRule = {
  id: string;
  action: ScannerRuleAction;
  decision: ScannerDecision;
  scopeType: ScannerRuleScope;
  scopeValue: string;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
};

export type ScannerRuleCandidate = {
  url: string;
  sourceDomain: string | null;
};

export type ScannerRuleMatch = {
  rule: ScannerFeedbackRule;
  action: ScannerRuleAction;
};

function normalizePathname(pathname: string): string {
  const compact = pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return compact || "/";
}

/**
 * The broader path scope is intentionally conservative. Reddit rules stop at
 * `r/<subreddit>`; other sites stop at the first two path segments. The UI
 * presents this exact value before the operator confirms a broad rule.
 */
export function sourcePathScopeValue(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(canonicalizeUrl(url));
  } catch {
    return null;
  }

  const domain = registrableDomain(parsed.hostname);
  if (!domain) return null;
  const segments = normalizePathname(parsed.pathname).split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (domain === "reddit.com" && segments[0]?.toLowerCase() === "r" && segments[1]) {
    return `${domain}/r/${segments[1].toLowerCase()}`;
  }

  return `${domain}/${segments.slice(0, 2).join("/")}`;
}

export function scannerRuleScopeValue(
  scope: ScannerRuleScope,
  candidate: ScannerRuleCandidate,
): string | null {
  if (scope === "exact_url") {
    try {
      return canonicalizeUrl(candidate.url);
    } catch {
      return null;
    }
  }
  if (scope === "source_path") return sourcePathScopeValue(candidate.url);
  return registrableDomain(candidate.sourceDomain);
}

function activeAt(rule: ScannerFeedbackRule, nowMs: number): boolean {
  if (rule.revokedAt) return false;
  if (!rule.expiresAt) return true;
  const expiresMs = new Date(rule.expiresAt).getTime();
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

const SCOPE_SPECIFICITY: Record<ScannerRuleScope, number> = {
  exact_url: 3,
  source_path: 2,
  source_domain: 1,
};

/**
 * Match the most specific active rule. A newer rule wins within one scope, so
 * an explicit Relevant decision can supersede an older exact-URL rejection.
 */
export function matchScannerFeedbackRule(
  candidate: ScannerRuleCandidate,
  rules: ScannerFeedbackRule[],
  now = new Date(),
): ScannerRuleMatch | null {
  const nowMs = now.getTime();
  const values: Record<ScannerRuleScope, string | null> = {
    exact_url: scannerRuleScopeValue("exact_url", candidate),
    source_path: scannerRuleScopeValue("source_path", candidate),
    source_domain: scannerRuleScopeValue("source_domain", candidate),
  };

  const matches = rules.filter(
    (rule) => activeAt(rule, nowMs) && values[rule.scopeType] !== null && values[rule.scopeType] === rule.scopeValue,
  );
  matches.sort((left, right) => {
    const specificity = SCOPE_SPECIFICITY[right.scopeType] - SCOPE_SPECIFICITY[left.scopeType];
    if (specificity !== 0) return specificity;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  const rule = matches[0];
  return rule ? { rule, action: rule.action } : null;
}

export function isScannerDecision(value: string): value is ScannerDecision {
  return (SCANNER_DECISIONS as readonly string[]).includes(value);
}

export function isScannerRuleScope(value: string): value is ScannerRuleScope {
  return (SCANNER_RULE_SCOPES as readonly string[]).includes(value);
}
