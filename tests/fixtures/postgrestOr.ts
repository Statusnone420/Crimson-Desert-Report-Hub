/**
 * Minimal evaluator for the PostgREST `or=` expressions this repo actually
 * sends, so the in-memory fakes can honour them instead of ignoring them.
 *
 * Ignoring `or` is not a harmless simplification: the feedback-rule keyset
 * walk uses it as its page cursor, so a fake that dropped the filter would
 * hand back page one forever and a paging regression would pass.
 *
 * Deliberately narrow — anything outside the shapes below throws rather than
 * quietly evaluating to true.
 */

type Row = Record<string, unknown>;

/** Split on top-level commas only, so `and(a,b)` stays one arm. */
function splitArms(expression: string): string[] {
  const arms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      arms.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  arms.push(expression.slice(start));
  return arms.map((arm) => arm.trim()).filter((arm) => arm.length > 0);
}

function matchesLeaf(row: Row, leaf: string): boolean {
  const first = leaf.indexOf(".");
  const second = leaf.indexOf(".", first + 1);
  if (first === -1 || second === -1) throw new Error(`unsupported or() leaf ${leaf}`);
  const column = leaf.slice(0, first);
  const operator = leaf.slice(first + 1, second);
  const value = leaf.slice(second + 1);
  const actual = row[column];

  if (operator === "is") {
    if (value !== "null") throw new Error(`unsupported or() leaf ${leaf}`);
    return actual == null;
  }
  if (actual == null) return false;
  const left = String(actual);
  switch (operator) {
    case "eq":
      return left === value;
    case "lt":
      return left < value;
    case "gt":
      return left > value;
    default:
      throw new Error(`unsupported or() operator ${operator}`);
  }
}

function matchesArm(row: Row, arm: string): boolean {
  if (arm.startsWith("and(") && arm.endsWith(")")) {
    return splitArms(arm.slice(4, -1)).every((leaf) => matchesLeaf(row, leaf));
  }
  return matchesLeaf(row, arm);
}

export function matchesOrExpression(row: Row, expression: string): boolean {
  const body = expression.startsWith("(") && expression.endsWith(")") ? expression.slice(1, -1) : expression;
  return splitArms(body).some((arm) => matchesArm(row, arm));
}
