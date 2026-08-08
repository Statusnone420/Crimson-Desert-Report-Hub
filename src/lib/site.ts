export const SITE_URL = "https://crimsonreporthub.com";
export const SITE_NAME = "Crimson Desert Report Hub";
/** Search-result title: brand phrase first, then what the site is. Keep ≤60 chars. */
export const SITE_SEARCH_TITLE = `${SITE_NAME} — Patch Issues & Player Reports`;
/** Search-snippet description. Keep ≤160 chars. */
export const SITE_DESCRIPTION =
  "Crimson Desert Report Hub is the unofficial brief on each patch — charting what players report, what sources pick up, and which claimed fixes haven't settled.";
/** Share-card text for surfaces that show text without the image. */
export const SITE_OG_DESCRIPTION =
  "What changed. What players are reporting. What matters now. An unofficial, fan-run field report on the current state of the game.";
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
 * only the URL.
 */
export async function routeMetadata(
  title: string,
  path: `/${string}`,
  description: string,
  parent: import("next").ResolvingMetadata,
): Promise<import("next").Metadata> {
  const parentOpenGraph = (await parent).openGraph as
    | NonNullable<import("next").Metadata["openGraph"]>
    | null;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...parentOpenGraph, url: path },
  };
}
