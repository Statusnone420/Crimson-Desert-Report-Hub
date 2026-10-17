/**
 * Titles that name a page, a site or the absence of an issue, never an issue.
 * The page-title fallback and the model's "no issue" answers produce them; a
 * signal with one is stored without a cluster so it cannot mint or join one.
 */
const JUNK_TITLES = [
  // HTTP error pages.
  /^[45]\d\d (?:bad request|unauthorized|forbidden|not found|too many requests|internal server error|bad gateway|service unavailable|gateway time-?out)\b/,
  // Bare site, forum and subreddit names.
  /^(?:reddit - )?the heart of the internet$/,
  /^r\/\w+(?: - reddit)?$/,
  /^(?:steam community :: )?crimson desert(?: enhanced)?(?: general discussions| discussões gerais)?(?: - reddit)?$/,
  /^crimson desert - .*\bforum - page \d+/,
  /^post - x$/,
  /^@[\w.]+$/,
  // Store and release notices: a sale, or news that a patch is out.
  /\bon sale for \d{1,2}% off\b/,
  /\b(?:patch|update|hotfix) \d+\.\d{1,2}(?:\.\d{1,2})? released (?:&|and) detailed\b/,
  /\breceived (?:an? )?(?:update|patch|hotfix) \d+\.\d{1,2}(?:\.\d{1,2})? bringing\b/,
  /^(?:update|patch|hotfix) \d+\.\d{1,2}(?:\.\d{1,2})? (?:broadly )?addresses\b/,
  // An official fix line quoted as the title, unless the title says it persists.
  /^["“']?(?:fixed|improved|resolved) an issue where\b(?!.*\b(?:still|but|again|persists?|not fixed)\b)/,
  // Wiki and roundup pages that list many issues.
  /\bglitches (?:&|and) exploits\b/,
  /\b(?:known|reported)(?:\/(?:known|reported))? issues roundup\b/,
  // The extraction fallback when a page has no title.
  /^crimson desert community signal$/,
  // The model's placeholders for a source without a game issue.
  /^no (?:specific )?(?:[\w-]+ ){0,3}issues? (?:was |were )?(?:reported|identified|found|described)\b/,
];

export function isJunkClusterTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized === "" || JUNK_TITLES.some((pattern) => pattern.test(normalized));
}
