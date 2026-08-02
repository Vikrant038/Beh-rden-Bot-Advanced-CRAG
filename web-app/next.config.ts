import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Static security headers applied to every response.
 * NOTE: Content-Security-Policy is intentionally NOT set here.
 * It is injected per-request by middleware.ts so the nonce value can be
 * embedded into the script-src directive (replacing unsafe-inline).
 * See src/middleware.ts for the nonce generation and CSP construction.
 */
const securityHeaders: Array<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

if (isProduction) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
