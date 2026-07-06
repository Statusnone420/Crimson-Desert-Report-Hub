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

/**
 * Count independent sources by registrable domain. Any number of subdomains of
 * one registrable domain contribute exactly one independent source, closing the
 * subdomain-fabrication path in the promotion gate.
 */
export function countIndependentDomains(hostnames: string[]): {
  independentDomainCount: number;
  trustedDomainCount: number;
} {
  const registrable = new Set<string>();
  for (const hostname of hostnames) {
    const domain = registrableDomain(hostname);
    if (domain) registrable.add(domain);
  }
  let trustedDomainCount = 0;
  for (const domain of registrable) if (TRUSTED_DOMAINS.has(domain)) trustedDomainCount += 1;
  return { independentDomainCount: registrable.size, trustedDomainCount };
}
