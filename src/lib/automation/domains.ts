const TRUSTED_DOMAINS = new Set([
  "reddit.com",
  "steamcommunity.com",
  "pearlabyss.com",
  "crimsondesert.pearlabyss.com",
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

export type DomainTier = "trusted" | "unknown";

export function domainTier(domain: string | null): DomainTier {
  if (!domain) return "unknown";
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  if (TRUSTED_DOMAINS.has(normalized)) return "trusted";
  // subdomain of a trusted domain counts (old.reddit.com, forums.pearlabyss.com)
  for (const trusted of TRUSTED_DOMAINS) {
    if (normalized.endsWith(`.${trusted}`)) return "trusted";
  }
  return "unknown";
}
