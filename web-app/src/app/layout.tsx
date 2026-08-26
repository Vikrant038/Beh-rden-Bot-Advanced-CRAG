import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/lib/trpc/provider";
import { PreferenceProvider } from "@/components/preferences/preference-provider";
import { APP_NAME, APP_DESCRIPTION, APP_URL, PAGE_TAGLINE } from "@/config/app";

// The CSP in middleware.ts uses a per-request nonce so inline scripts (Next.js
// bootstrap: __next_f flight data, theme init, $RT/$RB/$RV hydration) can run
// without 'unsafe-inline'. Nonces can only be attached when the page renders
// per-request — a statically prerendered HTML file has no request to draw a
// nonce from, so its inline scripts get blocked by the CSP and the page never
// hydrates (blank screen). Force dynamic rendering so the renderer can read
// the CSP from the forwarded request headers and stamp the nonce on scripts.
export const dynamic = "force-dynamic";

// #7 — mobile viewport: fit the iOS notch and never scale content past the screen.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// APP_NAME, APP_DESCRIPTION, APP_URL, and PAGE_TAGLINE imported from
// @/config/app — the single source of truth for all app-identity values.
// ════════════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} | ${PAGE_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: `${APP_NAME} | ${PAGE_TAGLINE}`,
    description: APP_DESCRIPTION,
    type: "website",
    url: APP_URL,
    siteName: APP_NAME,
    locale: "en_IN",
    images: [
      {
        url: "/Images/hero-image.jpeg",
        width: 1200,
        height: 630,
        alt: "Behörden-Bot — AI assistant for German student visas, APS, and blocked accounts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} | ${PAGE_TAGLINE}`,
    description: APP_DESCRIPTION,
    images: ["/Images/hero-image.jpeg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  manifest: "/manifest.webmanifest",
};


// ─── Cloudinary hero asset preloads ─────────────────────────────────────────
// The scroll engine's first scene still and clip are the LCP elements on the
// landing page. Emitting <link rel="preload"> from the server HTML response
// means the browser starts fetching them during the initial TCP round-trip —
// before React hydrates or any client JS runs.
const SCROLL_ASSETS_BASE = (
  process.env.SCROLL_ASSETS_URL ||
  process.env.NEXT_PUBLIC_SCROLL_ASSETS_URL ||
  ""
).replace(/\/$/, "");

function cloudinaryUrl(path: string, type: "image" | "video") {
  if (!SCROLL_ASSETS_BASE) return null;
  if (SCROLL_ASSETS_BASE.includes("cloudinary.com") && !SCROLL_ASSETS_BASE.includes("/upload")) {
    return `${SCROLL_ASSETS_BASE}/${type}/upload${path}`;
  }
  return `${SCROLL_ASSETS_BASE}${path}`;
}

const HERO_STILL = cloudinaryUrl("/scroll/dream.png", "image");
const HERO_CLIP = cloudinaryUrl("/scroll/vid/dream.mp4", "video");

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce set by middleware. Passed to next-themes so its
  // inline theme-bootstrap <script> carries the nonce (otherwise the strict
  // CSP blocks it).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* LCP preloads — emitted in server HTML so the browser fetches hero
            assets in the very first network round-trip, before any JS runs. */}
        {HERO_STILL && (
          <link
            rel="preload"
            as="image"
            href={HERO_STILL}
            // @ts-expect-error fetchpriority is a valid HTML attribute not yet typed
            fetchpriority="high"
          />
        )}
        {HERO_CLIP && <link rel="preload" as="video" href={HERO_CLIP} />}
      </head>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <PreferenceProvider>
          <Providers nonce={nonce}>{children}</Providers>
        </PreferenceProvider>
      </body>
    </html>
  );
}
