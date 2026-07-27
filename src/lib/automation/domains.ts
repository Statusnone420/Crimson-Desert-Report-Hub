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

// The publisher's own registrable domains. Official pages are provider context
// — patch notes, known-issues notices — and provider context is never player
// evidence: an official page must not create a cluster or stand as an
// independent corroborating source, however many symptom nouns its known-issues
// list carries. The domain stays in TRUSTED_DOMAINS so the observation lane can
// carry official notices; it is excluded from independence counting instead.
const OFFICIAL_DOMAINS = new Set(["pearlabyss.com"]);

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
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

export function domainTier(domain: string | null): DomainTier {
  const registrable = registrableDomain(domain);
  if (!registrable) return "unknown";
  return TRUSTED_DOMAINS.has(registrable) ? "trusted" : "unknown";
}

/** True when the hostname collapses to one of the publisher's own domains. */
export function isOfficialDomain(hostname: string | null): boolean {
  const registrable = registrableDomain(hostname);
  return registrable ? OFFICIAL_DOMAINS.has(registrable) : false;
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
    return isOfficialDomain(new URL(input.url).hostname);
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
  for (const hostname of hostnames) {
    const domain = registrableDomain(hostname);
    if (domain && !OFFICIAL_DOMAINS.has(domain)) registrable.add(domain);
  }
  let trustedDomainCount = 0;
  for (const domain of registrable) if (TRUSTED_DOMAINS.has(domain)) trustedDomainCount += 1;
  return { independentDomainCount: registrable.size, trustedDomainCount };
}
