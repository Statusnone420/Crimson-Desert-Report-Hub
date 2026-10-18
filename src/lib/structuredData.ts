import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import type { EditorialArticle } from "@/lib/editorialArticles";
import { absoluteSourceUrl, COLUMN_EDITOR, editionDescription, editorialPath, type PublicEdition } from "@/lib/editorials/content";

/** Homepage WebSite structured data (schema.org). */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "CD Report Hub",
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION,
  } as const;
}

/** Source-backed schema for a Report Hub article. Do not add an author or update date without one. */
export function newsArticleJsonLd(article: EditorialArticle) {
  const articleUrl = `${SITE_URL}${article.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
    mainEntityOfPage: articleUrl,
    image: [`${SITE_URL}${article.heroImage.src}`],
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
    },
    citation: article.sources.map((source) => source.url),
  } as const;
}

/** A State of the Game edition: authored by the house byline, with its named editor. */
export function editionJsonLd(edition: PublicEdition) {
  const editionUrl = `${SITE_URL}${editorialPath(edition.slug)}`;
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: edition.title,
    description: editionDescription(edition),
    datePublished: edition.publishAt,
    mainEntityOfPage: editionUrl,
    author: { "@type": "Organization", name: edition.author },
    editor: { "@type": "Person", name: COLUMN_EDITOR },
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
    },
    citation: edition.factsBox.sources.map((source) => absoluteSourceUrl(source.url)),
  } as const;
}

/**
 * JSON-LD goes in a native script tag; `<` must be escaped because
 * JSON.stringify does not sanitize against `</script>` injection.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
