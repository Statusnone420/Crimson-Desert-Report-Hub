import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// No lastModified on purpose: there is no truthful per-route modification
// date available at build time, and a blanket build date would claim every
// page changed on every deploy. changeFrequency mirrors how the content
// actually moves — the brief, board, and observatory follow the hourly scan;
// the report form and method page change only with releases.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/issues`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/observatory`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/patches`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/articles/charting-the-unknown`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/report`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
