import { registrableDomain } from "@/lib/automation/domains";

/**
 * Active lessons are a record of decisions already made, not a queue. Rendering
 * one row per rule turned ~70 finished decisions into two thirds of the operator
 * page, so the ledger groups them and keeps every individual row — with its own
 * reason and its own Undo — one disclosure inside its group.
 *
 * Grouping is presentation only. No rule is merged, hidden, or made revocable in
 * bulk: the group is a heading over the same rows.
 */

export type LessonGroupable = {
  action: string;
  scope_type: string;
  scope_value: string;
};

export type ScannerLessonGroup<Rule extends LessonGroupable> = {
  key: string;
  action: string;
  scopeType: string;
  /** Registrable domain when one can be derived, else the raw scope value. */
  label: string;
  rules: Rule[];
};

export type ScannerLessonSummary = {
  total: number;
  blocks: number;
  keeps: number;
  domains: number;
};

/**
 * The domain a rule is about, whatever its scope shape:
 * `source_domain` already is one, `source_path` is `domain/segments`, and
 * `exact_url` needs its hostname read. A value that parses as none of those
 * falls back to itself rather than being grouped under a guess.
 */
export function lessonRuleDomain(rule: LessonGroupable): string {
  const value = rule.scope_value.trim();
  if (!value) return "unknown";
  if (rule.scope_type === "source_domain") return registrableDomain(value) ?? value;
  if (rule.scope_type === "source_path") {
    const [host] = value.split("/");
    return registrableDomain(host ?? value) ?? value;
  }
  try {
    return registrableDomain(new URL(value).hostname) ?? value;
  } catch {
    return registrableDomain(value) ?? value;
  }
}

/**
 * Groups keep the order their first rule appeared in, so the newest decision
 * still surfaces at the top of the ledger rather than the alphabet deciding.
 */
export function groupScannerLessons<Rule extends LessonGroupable>(
  rules: readonly Rule[],
): ScannerLessonGroup<Rule>[] {
  const groups = new Map<string, ScannerLessonGroup<Rule>>();
  for (const rule of rules) {
    const label = lessonRuleDomain(rule);
    const key = `${rule.action}|${rule.scope_type}|${label}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rules.push(rule);
      continue;
    }
    groups.set(key, { key, action: rule.action, scopeType: rule.scope_type, label, rules: [rule] });
  }
  return [...groups.values()];
}

export function summarizeScannerLessons(rules: readonly LessonGroupable[]): ScannerLessonSummary {
  const domains = new Set<string>();
  let blocks = 0;
  let keeps = 0;
  for (const rule of rules) {
    domains.add(lessonRuleDomain(rule));
    if (rule.action === "block") blocks += 1;
    else if (rule.action === "allow") keeps += 1;
  }
  return { total: rules.length, blocks, keeps, domains: domains.size };
}

/**
 * A rule's target, shortened for the group row. The full value still renders
 * inside the expanded row — this only stops an 80-character URL setting the
 * width of a summary line.
 */
export function shortLessonTarget(rule: LessonGroupable, maxLength = 52): string {
  const value = rule.scope_value.trim();
  const withoutScheme = value.replace(/^https?:\/\//i, "");
  if (withoutScheme.length <= maxLength) return withoutScheme;
  return `…${withoutScheme.slice(-(maxLength - 1))}`;
}
