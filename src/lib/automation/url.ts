import { registrableDomain } from "@/lib/automation/domains";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

/**
 * Per-domain query parameters that change nothing about which page you land on.
 *
 * Deliberately not global: `l` means "interface language" on Steam and could
 * mean anything on a site we have never looked at. Stripping a parameter that
 * turns out to be load-bearing merges two different pages into one lead, which
 * is worse than the duplicate it was meant to prevent.
 */
const SITE_DISPLAY_PARAMS: Record<string, ReadonlySet<string>> = {
  // `l` is the interface language; `curator_clanid` and `snr` record which page
  // you arrived from. One discussion thread reaches us under all of them.
  "steamcommunity.com": new Set(["l", "curator_clanid", "snr"]),
  "store.steampowered.com": new Set(["l", "curator_clanid", "snr"]),
};

function droppableParams(hostname: string): ReadonlySet<string> | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return SITE_DISPLAY_PARAMS[host] ?? SITE_DISPLAY_PARAMS[registrableDomain(host) ?? ""] ?? null;
}

/** Browser-safe URL normalization shared by scanner previews and server logic. */
export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  const siteParams = droppableParams(url.hostname);
  for (const key of [...url.searchParams.keys()]) {
    const name = key.toLowerCase();
    if (TRACKING_PARAMS.has(name) || siteParams?.has(name)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}
