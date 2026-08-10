import type { MetadataRoute } from "next";
import { SEO_BASE_URL } from "@/config/app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/chat/", "/history", "/sources", "/settings", "/admin"],
      },
    ],
    sitemap: `${SEO_BASE_URL}/sitemap.xml`,
  };
}
