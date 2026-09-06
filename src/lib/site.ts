export const SITE_URL = "https://crimsonreporthub.com";
export const SITE_NAME = "Crimson Desert Report Hub";
/** Search-result title: brand phrase first, then what the site is. Keep ≤60 chars. */
export const SITE_SEARCH_TITLE = `${SITE_NAME} — News & Expansion Reports`;
/** Search-snippet description. Keep ≤160 chars. */
export const SITE_DESCRIPTION =
  "Crimson Desert Report Hub is an unofficial newspaper for Crimson Desert news, expansion reports, official updates, and player records.";
/** Share-card text for surfaces that show text without the image. */
export const SITE_OG_DESCRIPTION =
  "Crimson Desert news, Charting the Unknown coverage, creator videos, and official updates from an unofficial fan newspaper.";
export const SOURCE_URL = "https://github.com/Statusnone420/Crimson-Desert-Report-Hub";
export const PEARL_ABYSS_SUPPORT_URL = "https://support.pearlabyss.com/";

/**
 * Root Open Graph block. Never add `images`: the opengraph-image.png file
 * convention attaches the share card only while the metadata object omits
 * that key.
 */
export function routeOpenGraph(path: "/" | `/${string}`) {
  return {
    type: "website",
    url: path,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_OG_DESCRIPTION,
  } satisfies NonNullable<import("next").Metadata["openGraph"]>;
}

/**
 * Per-route metadata: distinct title + search description, plus matching
 * canonical and og:url. Built on
 * generateMetadata parent resolution because a plain route-level `openGraph`
 * object shallow-replaces the root's RESOLVED block — silently dropping the
 * share-card images the file convention attached there. Spreading the
 * resolved parent keeps those images (hashed URLs included) and overrides
 * route-specific titles, descriptions, and URLs.
 */
export async function routeMetadata(
  title: string,
  path: `/${string}`,
  description: string,
  parent: import("next").ResolvingMetadata,
): Promise<import("next").Metadata> {
  const resolvedParent = await parent;
  const parentOpenGraph = resolvedParent.openGraph as
    | NonNullable<import("next").Metadata["openGraph"]>
    | null;
  const parentTwitter = resolvedParent.twitter as
    | NonNullable<import("next").Metadata["twitter"]>
    | null;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...parentOpenGraph, url: path, title, description },
    twitter: { ...parentTwitter, title, description },
  };
}
