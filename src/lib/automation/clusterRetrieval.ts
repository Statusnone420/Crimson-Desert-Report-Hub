/**
 * Picks the known clusters most likely to describe the same problem as a new
 * source, so the extraction model compares it with a short, relevant list
 * instead of only the newest clusters. Retrieval proposes; it never assigns.
 * The model's sure answer and the parser's checks still decide the route.
 */

export type RetrievalCluster = {
  slug: string;
  title: string;
  category: string;
  description?: string | null;
  last_signal_at?: string | null;
  created_at?: string | null;
};

// Words that say nothing about which problem a page describes: filler, the
// game's own name and generic issue nouns would otherwise match every cluster.
const RETRIEVAL_STOPWORDS = new Set([
  "about", "after", "again", "all", "also", "and", "any", "anyone", "are", "been", "being", "but", "can",
  "cannot", "cant", "could", "did", "didnt", "does", "doesnt", "dont", "else", "even", "every", "for", "from",
  "get", "gets", "getting", "got", "had", "has", "have", "here", "how", "into", "its", "just", "many", "more",
  "most", "much", "not", "now", "off", "one", "only", "onto", "our", "out", "over", "please", "really", "should",
  "since", "some", "still", "than", "that", "the", "their", "them", "then", "there", "they", "this", "time",
  "times", "too", "two", "under", "very", "was", "were", "what", "when", "which", "while", "who", "why", "with",
  "would", "you", "your",
  "abyss", "bug", "bugs", "community", "crimson", "desert", "discussion", "discussions", "game", "games", "general",
  "help", "hotfix", "issue", "issues", "patch", "patches", "pearl", "player", "players", "post", "problem",
  "problems", "reddit", "report", "reported", "reports", "steam", "thread", "update", "updates", "version",
]);

// Light English suffix folding so "crashes", "crashing" and "crashed" meet,
// as do "freeze" and "freezes". It only has to be consistent, not correct.
function fold(word: string): string {
  let folded = word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (folded.length > suffix.length + 3 && folded.endsWith(suffix)) {
      folded = folded.slice(0, -suffix.length);
      break;
    }
  }
  return folded.length > 4 && folded.endsWith("e") ? folded.slice(0, -1) : folded;
}

// Short English words that say nothing about which problem a title names, and
// the pieces contractions split into ("don't" gives "t"; NEGATION reads those).
const SHORT_FILLER = new Set([
  "a", "an", "am", "as", "at", "be", "by", "do", "go", "he", "i", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "ok",
  "on", "or", "so", "to", "up", "us", "we",
  "d", "ll", "m", "re", "s", "t", "ve",
]);
// Words that turn a title into its opposite: "Shadows do not appear indoors" is
// not "Shadows appear indoors".
const NEGATION = /\b(?:not|no|never|none|nothing|cannot|cant|dont|doesnt|didnt|wont|isnt|arent|wasnt|werent|without|unable)\b|n['’]t\b/i;

// What retrievalTokens drops that can still tell two problems apart: a negation,
// bare numbers ("Error 15" / "Error 30") and words under three letters ("UI" /
// "AI", "4K"), short English filler aside. Version numbers are left out, as the
// semantic fingerprint leaves them out, so "after 1.04" still meets "after the
// update".
function distinguishingTerms(title: string): string {
  const words = title
    .replace(/\bv?\d+(?:\.\d+)+\b/gi, " ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  // "!" never occurs in a word, so the negation mark cannot meet a real term.
  const terms = new Set<string>(NEGATION.test(title) ? ["!not"] : []);
  for (const word of words) {
    if (/^\d+$/.test(word)) terms.add(String(Number(word)));
    else if (word.length < 3 && !SHORT_FILLER.has(word)) terms.add(word);
  }
  return [...terms].sort().join(" ");
}

// Word pairs that turn a report into its opposite when one replaces the other
// ("Subtitles keep turning on" / "turning off"). At least one word of each pair
// is filler to retrievalTokens, so the word match alone cannot see the change.
const OPPOSITES = [["on", "off"], ["up", "down"], ["in", "out"], ["over", "under"], ["before", "after"], ["more", "less"]] as const;

function titleWords(title: string): Set<string> {
  return new Set(title.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

// True when the titles differ in both words of a pair: one says "on" where the
// other says "off". A word both titles share, or one only a single title has
// ("Crash on PS5" / "PS5 crash"), changes nothing.
function opposed(left: Set<string>, right: Set<string>): boolean {
  return OPPOSITES.some(([a, b]) => left.has(a) !== right.has(a) && left.has(b) !== right.has(b));
}

/** Distinct comparable words of a text, accents removed ("Créchard" meets "Crechard"). */
export function retrievalTokens(text: string): string[] {
  const words = text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = new Set<string>();
  for (const word of words) {
    if (word.length < 3 || /^\d+$/.test(word) || RETRIEVAL_STOPWORDS.has(word)) continue;
    tokens.add(fold(word));
  }
  return [...tokens];
}

/**
 * The automatic cluster whose title says the same thing as `issueTitle`, or
 * null. Consulted only where a source would otherwise start a new automatic
 * cluster, or stay unclustered: without it, every rewording ("Game crashes when
 * opening the map" / "Crash when opening map") started its own cluster, because
 * the exact fingerprint is the only other match a source the model never saw
 * can make. Deliberately strict: same category, at least two shared
 * distinctive words, and those cover three quarters of both titles, so titles
 * that share only a symptom ("crash opening map" / "crash opening inventory")
 * stay apart. One title's words must all appear in the other, so a swapped
 * word ("map screen" / "inventory screen") keeps them apart even at three
 * quarters, and so does a swapped pair of opposites ("turning on" / "turning
 * off", "after" / "before"). Both titles must also agree on negation and carry
 * the same numbers and short terms, versions aside, so "Shadows appear" /
 * "Shadows do not appear", "Error 15" / "Error 30" and "UI stutter" / "AI
 * stutter" stay apart too. A cluster whose signals were all moved elsewhere
 * (signal_count 0) is skipped, as the model's options skip it, so a relocation
 * is not undone; a cluster created earlier in the same batch carries no count
 * and is kept.
 */
export function nearDuplicateAutoCluster<T extends RetrievalCluster & { signal_count?: number | string | null }>(
  issueTitle: string,
  category: string,
  clusters: readonly T[],
): T | null {
  const wanted = new Set(retrievalTokens(issueTitle));
  if (wanted.size < 2) return null;
  const terms = distinguishingTerms(issueTitle);
  const wantedWords = titleWords(issueTitle);
  let best: { cluster: T; score: number } | null = null;
  for (const cluster of clusters) {
    if (!cluster.slug.startsWith("auto-") || String(cluster.category) !== category) continue;
    if (cluster.signal_count !== null && cluster.signal_count !== undefined && Number(cluster.signal_count) === 0) continue;
    if (distinguishingTerms(cluster.title) !== terms) continue;
    const tokens = new Set(retrievalTokens(cluster.title));
    let shared = 0;
    for (const token of wanted) if (tokens.has(token)) shared += 1;
    const score = shared / Math.max(wanted.size, tokens.size);
    if (shared < 2 || score < 0.75) continue;
    // A rewording adds or drops words. When each title has a word the other
    // lacks, one was swapped for another and names a different target ("map
    // screen" / "inventory screen").
    if (shared < wanted.size && shared < tokens.size) continue;
    if (opposed(wantedWords, titleWords(cluster.title))) continue;
    if (!best || score > best.score || (score === best.score && compareClusterRecency(cluster, best.cluster) < 0)) {
      best = { cluster, score };
    }
  }
  return best?.cluster ?? null;
}

/** Newest activity first, then creation, then slug: bounded and reproducible. */
export function compareClusterRecency(left: RetrievalCluster, right: RetrievalCluster): number {
  for (const field of ["last_signal_at", "created_at"] as const) {
    const leftValue = left[field] ?? "";
    const rightValue = right[field] ?? "";
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? 1 : -1;
  }
  if (left.slug === right.slug) return 0;
  return left.slug < right.slug ? -1 : 1;
}

/**
 * Scores clusters by the words they share with a source, each word weighted by
 * how rare it is among clusters, so a quest or place name counts for more than
 * "crash". Longer cluster texts are damped so a long description cannot win on
 * size alone. Clusters with no shared word are never proposed.
 */
export function createClusterRetriever<T extends RetrievalCluster>(clusters: T[], limit: number): (text: string) => T[] {
  const documents = clusters.map((cluster) => ({
    cluster,
    tokens: new Set(retrievalTokens(`${cluster.title} ${cluster.description ?? ""}`)),
  }));
  const documentFrequency = new Map<string, number>();
  for (const { tokens } of documents) {
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const total = Math.max(1, documents.length);
  return (text) => {
    const query = retrievalTokens(text);
    if (query.length === 0 || limit <= 0) return [];
    return documents
      .map(({ cluster, tokens }) => {
        let score = 0;
        for (const token of query) {
          if (tokens.has(token)) score += Math.log(1 + total / (documentFrequency.get(token) ?? 1));
        }
        return { cluster, score: score > 0 ? score / Math.sqrt(tokens.size) : 0 };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || compareClusterRecency(left.cluster, right.cluster))
      .slice(0, limit)
      .map((entry) => entry.cluster);
  };
}
