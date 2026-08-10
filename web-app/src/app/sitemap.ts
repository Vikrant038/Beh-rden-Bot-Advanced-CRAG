import type { MetadataRoute } from "next";
import { SEO_BASE_URL } from "@/config/app";

/**
 * Public, indexable routes. Authenticated areas (/chat, /history, /settings,
 * /admin) are intentionally excluded — they are user-specific and would show
 * as soft-404s to crawlers.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${SEO_BASE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SEO_BASE_URL}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
