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
  // The extraction fallback when a page has no title.
  /^crimson desert community signal$/,
  // The model's placeholders for a source without a game issue.
  /^no (?:specific )?(?:[\w-]+ ){0,3}issues? (?:was |were )?(?:reported|identified|found|described)\b/,
];

export function isJunkClusterTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized === "" || JUNK_TITLES.some((pattern) => pattern.test(normalized));
}
