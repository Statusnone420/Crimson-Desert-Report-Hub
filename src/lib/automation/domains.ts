const TRUSTED_DOMAINS = new Set([
  "reddit.com",
  "steamcommunity.com",
  "pearlabyss.com",
  "ign.com",
  "pcgamer.com",
  "rockpapershotgun.com",
  "eurogamer.net",
  "gamespot.com",
  "kotaku.com",
  "polygon.com",
  "vg247.com",
  "pushsquare.com",
  "purexbox.com",
  "dsogaming.com",
  "wccftech.com",
  "tomshardware.com",
]);

// The Crimson Desert wiki on Fextralife. Fextralife runs wikis for many games
// and open forums, so only these hosts are trusted and read, not the rest of
// fextralife.com. The older host redirects to the current one. Independence is
// still counted by registrable domain.
const CRIMSON_DESERT_WIKI_HOSTS = new Set([
  "crimsondesertgame.wiki.fextralife.com",
  "crimsondesert.wiki.fextralife.com",
]);

// Trust and page reading are separate decisions. Trust decides which search
// results count toward the two-source rule; this list decides where a recon
// fetch may spend a Tavily extract credit. Checks in October 2026 showed that
// extract returns readable text for these sites and the wiki above. It
// returns nothing for reddit.com and gamespot.com, only an empty page shell for
// the Steam store and Steam discussions, and is blocked by resetera.com and
// x.com, so a thin result from those sites is judged on its search snippet
// alone. Official pages are listed but never fetched, because a rescue cannot
// change their verdict (see isBorderlineRescueCandidate). YouTube is readable
// but is not a trusted source, and recon only considers trusted results.
//
// Made in good faith: IGN, Eurogamer, Rock Paper Shotgun, Polygon and the
// Fextralife wiki stay listed although their robots.txt asks for no automated
// retrieval or AI use. The project respectfully declines that request for this
// narrow use; it is not malicious use of their content. The Hub is a solo,
// non-commercial fan site maintained with AI assistance. Recon is a light source
// check on high-quality sources: at most two page reads per scan, every two
// hours, with no crawling, reselling or training. Every lead credits and links
// to its source, so readers visit the publisher's page, as the Watch page does
// for videos. A blocked or empty fetch only skips the page. Changing this list is
// a maintainer decision.
const RECON_EXTRACT_DOMAINS = new Set([
  "pearlabyss.com",
  "ign.com",
  "pcgamer.com",
  "rockpapershotgun.com",
  "eurogamer.net",
  "polygon.com",
  "youtube.com",
]);

// The publisher's own registrable domains. Official pages are provider context
// — patch notes, known-issues notices — and provider context is never player
// evidence: an official page must not create a cluster or stand as an
// independent corroborating source, however many symptom nouns its known-issues
// list carries. The domain stays in TRUSTED_DOMAINS so the observation lane can
// carry official notices; it is excluded from independence counting instead.
const OFFICIAL_DOMAINS = new Set(["pearlabyss.com"]);

// The publisher posts the same announcements, patch notes included, on the
// game's Steam pages, and the official patch record reads them from Steam's
// news API. Those pages are official context too. The rest of Steam is not:
// steamcommunity.com carries player discussions and the store serves the review
// lane, so an announcement is matched by its path, never by its domain.
// 3321460 is CRIMSON_DESERT_STEAM_APP_ID.
function isSteamAnnouncementUrl(url: URL): boolean {
  const registrable = registrableDomain(url.hostname);
  if (registrable === "steampowered.com") return /^\/news\/app\/3321460(?:\/|$)/i.test(url.pathname);
  if (registrable === "steamcommunity.com") return /^\/(?:games|ogg)\/3321460\/announcements(?:\/|$)/i.test(url.pathname);
  return false;
}

// Registrable-domain suffixes that span two labels. Kept deliberately small —
// only the public suffixes a Crimson Desert source realistically uses — so we
// collapse eTLD+1 correctly for our sources without a full public-suffix-list
// dependency.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.in",
  "com.br",
  "com.tr",
]);

export type DomainTier = "trusted" | "unknown";

/**
 * Collapse a hostname to its registrable domain (eTLD+1): `a.evilfarm.com` ->
 * `evilfarm.com`, `old.reddit.com` -> `reddit.com`, `sub.example.co.uk` ->
 * `example.co.uk`. The registrable domain is our unit of source independence —
 * sibling subdomains of ONE registrable domain must NOT count as separate
 * sources, or a single actor could fabricate "independent" corroboration.
 */
export function registrableDomain(hostname: string | null): string | null {
  if (!hostname) return null;
  const labels = normalizeHost(hostname).split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function isCrimsonDesertWikiHost(hostname: string | null): boolean {
  return hostname ? CRIMSON_DESERT_WIKI_HOSTS.has(normalizeHost(hostname)) : false;
}

export function domainTier(domain: string | null): DomainTier {
  if (isCrimsonDesertWikiHost(domain)) return "trusted";
  const registrable = registrableDomain(domain);
  if (!registrable) return "unknown";
  return TRUSTED_DOMAINS.has(registrable) ? "trusted" : "unknown";
}

/** True when the hostname collapses to one of the publisher's own domains. */
export function isOfficialDomain(hostname: string | null): boolean {
  const registrable = registrableDomain(hostname);
  return registrable ? OFFICIAL_DOMAINS.has(registrable) : false;
}

/** True when a recon fetch may read this host's page: Tavily extract returns its text. */
export function isReconExtractDomain(hostname: string | null): boolean {
  if (isCrimsonDesertWikiHost(hostname)) return true;
  const registrable = registrableDomain(hostname);
  return registrable ? RECON_EXTRACT_DOMAINS.has(registrable) : false;
}

/**
 * The single provider-context boundary: the platform's own reviews and the
 * publisher's own pages are context about the game, never player evidence.
 * The promotion engine, the clustering no-create guard, the public evidence
 * filters, and the radar's tracked-lead filter all ask this one predicate, so
 * the definition cannot fork the way parallel pattern lists once did (that
 * drift is how real complaints leaked one symptom at a time). Callers pass
 * what their row carries: a row missing sourceType is judged on source alone,
 * and a domain that clears the check still falls through to the url, so a
 * nullable or mis-stamped domain column can never slip an official page past
 * the boundary. An unparseable url is not provider context — it is nothing,
 * and other gates drop it.
 */
export function isProviderContextSource(input: {
  source?: string | null;
  sourceType?: string | null;
  domain?: string | null;
  url?: string | null;
}): boolean {
  if (input.source === "steam_review" || input.sourceType === "steam_review") return true;
  if (input.domain && isOfficialDomain(input.domain)) return true;
  if (!input.url) return false;
  try {
    const url = new URL(input.url);
    return isOfficialDomain(url.hostname) || isSteamAnnouncementUrl(url);
  } catch {
    return false;
  }
}

/**
 * Count independent sources by registrable domain. Any number of subdomains of
 * one registrable domain contribute exactly one independent source, closing the
 * subdomain-fabrication path in the promotion gate. Official publisher domains
 * contribute nothing at all: provider context is never player evidence, so an
 * official page must not be the second domain that promotes a cluster — this
 * also retroactively disarms any official row already stored as a signal.
 */
export function countIndependentDomains(hostnames: string[]): {
  independentDomainCount: number;
  trustedDomainCount: number;
} {
  const registrable = new Set<string>();
  // A registrable domain counts as trusted when one of its hosts is trusted.
  const trusted = new Set<string>();
  for (const hostname of hostnames) {
    const domain = registrableDomain(hostname);
    if (!domain || OFFICIAL_DOMAINS.has(domain)) continue;
    registrable.add(domain);
    if (domainTier(hostname) === "trusted") trusted.add(domain);
  }
  return { independentDomainCount: registrable.size, trustedDomainCount: trusted.size };
}
