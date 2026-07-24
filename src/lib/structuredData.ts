import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

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

/**
 * JSON-LD goes in a native script tag; `<` must be escaped because
 * JSON.stringify does not sanitize against `</script>` injection.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
