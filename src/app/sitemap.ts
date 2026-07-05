import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const lastModified = new Date("2026-07-05T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/issues`, lastModified, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/report`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: "monthly", priority: 0.6 },
  ];
}
