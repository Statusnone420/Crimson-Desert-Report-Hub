import "server-only";

import { rejectPaidOpenRouterModel } from "@/lib/automation/budget";
import { normalizeText } from "@/lib/automation/dedupe";
import { CATEGORY_LABELS, PLATFORM_LABELS, type Category, type Platform } from "@/lib/constants";

export type ModerationInput = {
  issueTitle: string;
  description: string;
  category: Category;
  platform: Platform;
  severity: string;
  frequency: string;
};

export type ClusterRef = { id: string; title: string; category: string };

export type ModerationDecision = {
  status: "approved" | "pending" | "spam";
  clusterId: string | null;
  publicSummary: string | null;
  reason: string;
  aiUsed: boolean;
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_TIMEOUT_MS = 5000;

const SPAM_PATTERNS = [
  /\b(?:buy|cheap|free|sell(?:ing)?)\s+(?:gold|coins?|credits?|followers?|accounts?|keys?|viagra)\b/i,
  /\b(?:casino|crypto\s*airdrop|nft\s*drop|forex|onlyfans|telegram\s*@)\b/i,
  /(?:https?:\/\/\S+){3,}/i,
  /(.)\1{9,}/,
];

const PII_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.\w{2,}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
];

/**
 * Phone-shaped tokens only: 7-15 digits in at most 4 groups, formatted with
 * spaces/parens/dashes or a leading +. Dots are excluded and bare digit runs
 * are ignored so driver versions ("546.33"), save IDs, and frame-timing dumps
 * don't false-flag genuine bug reports.
 */
const PHONE_CANDIDATE = /\+?\d[\d ()-]{5,18}\d/g;

function containsPhoneNumber(text: string): boolean {
  for (const match of text.match(PHONE_CANDIDATE) ?? []) {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    const groups = match.split(/[ ()-]+/).filter(Boolean);
    if (groups.length > 4) continue;
    if (groups.length === 1 && !match.startsWith("+")) continue;
    return true;
  }
  return false;
}

const STOP_WORDS = new Set([
  "the", "and", "since", "with", "when", "after", "before", "that", "this", "have", "from",
  "game", "crimson", "desert", "issue", "issues", "bug", "bugs", "patch", "please", "keep",
  "still", "just", "getting", "happens", "happening", "cannot", "does", "not",
]);

function looksLikeSpam(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

function hasPersonalData(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  return PII_PATTERNS.some((pattern) => pattern.test(text)) || containsPhoneNumber(text);
}

function keywords(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

/** Deterministic cluster match by shared keywords within the same category. */
export function matchCluster(input: ModerationInput, clusters: ClusterRef[]): string | null {
  const reportWords = keywords(`${input.issueTitle} ${input.description}`);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const cluster of clusters) {
    if (cluster.category !== input.category) continue;
    let overlap = 0;
    for (const word of keywords(cluster.title)) {
      if (reportWords.has(word)) overlap += 1;
    }
    if (overlap > bestScore) {
      bestScore = overlap;
      bestId = cluster.id;
    }
  }
  return bestScore >= 1 ? bestId : null;
}

/** Neutral public text, built only from validated enums — never the user's raw words. */
export function neutralSummary(input: ModerationInput): string {
  const platform = PLATFORM_LABELS[input.platform] ?? "A";
  const category = (CATEGORY_LABELS[input.category] ?? input.category).toLowerCase();
  return `${platform} player reports a ${category} issue (${input.frequency}, ${input.severity} severity).`;
}

/**
 * Best-effort AI screen on a free OpenRouter model. Can only downgrade a report
 * to "flagged for review" — it never rejects or publishes text, so a flaky or
 * missing model is always safe and free. Returns null when unavailable.
 */
async function aiScreen(input: ModerationInput): Promise<{ relevant: boolean; sensitive: boolean } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_FREE_MODEL?.trim();
  if (!apiKey || !model) return null;
  try {
    rejectPaidOpenRouterModel(model);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You screen video game bug reports. Return only JSON." },
          {
            role: "user",
            content: [
              "Is the text below a genuine Crimson Desert game bug, crash, or performance report (not spam, ads, or abuse)?",
              "Also flag if it contains personal data (real names, emails, phone numbers).",
              'Return only {"relevant": boolean, "sensitive": boolean}.',
              `Title: ${input.issueTitle}`,
              `Description: ${input.description.slice(0, 1200)}`,
            ].join("\n"),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(content) as { relevant?: unknown; sensitive?: unknown };
    return { relevant: parsed.relevant !== false, sensitive: parsed.sensitive === true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function moderateReport(input: ModerationInput, clusters: ClusterRef[]): Promise<ModerationDecision> {
  if (looksLikeSpam(input.issueTitle, input.description)) {
    return { status: "spam", clusterId: null, publicSummary: null, reason: "spam_pattern", aiUsed: false };
  }

  const clusterId = matchCluster(input, clusters);
  const publicSummary = neutralSummary(input);

  let status: "approved" | "pending" = "approved";
  let reason = "auto_approved";
  if (hasPersonalData(input.issueTitle, input.description)) {
    status = "pending";
    reason = "flagged_personal_data";
  }

  const ai = await aiScreen(input);
  if (ai) {
    if (!ai.relevant) {
      status = "pending";
      reason = "flagged_ai_relevance";
    } else if (ai.sensitive && status === "approved") {
      status = "pending";
      reason = "flagged_ai_sensitive";
    }
  }

  return { status, clusterId, publicSummary, reason, aiUsed: ai !== null };
}
