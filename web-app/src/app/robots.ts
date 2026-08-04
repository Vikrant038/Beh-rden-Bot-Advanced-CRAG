import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://behoerden-bot.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/chat/", "/history", "/sources", "/settings", "/admin"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
