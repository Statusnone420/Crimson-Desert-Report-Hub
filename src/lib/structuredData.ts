import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import type { EditorialArticle } from "@/lib/editorialArticles";

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

/**
 * JSON-LD goes in a native script tag; `<` must be escaped because
 * JSON.stringify does not sanitize against `</script>` injection.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
