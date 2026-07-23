import "server-only";

import { createHash } from "node:crypto";

export { canonicalizeUrl } from "@/lib/automation/url";

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Filler that varies between two phrasings of the SAME complaint: articles,
// first-person narration, and patch-version framing. Two Tavily encounters of
// one Reddit post ("Since the 1.14.00 patch, I've been experiencing constant
// graphics glitches on the Xbox." vs the shorter rewrite "constant graphics
// glitches on Xbox") must land on one fingerprint, or each phrasing spawns its
// own auto-cluster. Symptom nouns are never stopwords, so distinct issues keep
// distinct fingerprints.
const FINGERPRINT_STOPWORDS = new Set([
  "a", "an", "the", "on", "in", "at", "of", "for", "to", "and", "or",
  "is", "are", "was", "were", "be", "been", "being",
  "i", "ive", "im", "my", "me",
  "have", "has", "had", "having", "getting", "seeing", "experiencing", "noticing",
  "constant", "constantly",
  "since", "after", "patch", "update", "version",
]);

const VERSION_TOKEN = /\b\d+(?:\.\d+)+\b/g;

export function semanticFingerprint(title: string, category: string): string {
  const base = normalizeText(title);
  const condensed = base
    .replace(VERSION_TOKEN, " ")
    // normalizeText keeps dots only so version numbers survive to this point;
    // once versions are stripped, remaining dots are sentence punctuation.
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter((token) => token && !FINGERPRINT_STOPWORDS.has(token))
    .join(" ");
  return hashValue(`${category}|${condensed || base}`);
}
