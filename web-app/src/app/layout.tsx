import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/lib/trpc/provider";
import { PreferenceProvider } from "@/components/preferences/preference-provider";

const APP_NAME = "Behörden-Bot";
const APP_DESCRIPTION =
  "AI assistant for German student visa, APS certification, university applications, blocked accounts, and immigration questions — built for Indian students.";
// Canonical public URL for metadataBase/OG/canonical. Derived from the
// validated NEXTAUTH_URL so production (Vercel) and local builds both get the
// correct origin without a hardcoded, rot-prone domain. Treat an empty string
// as unset (platform dashboards store "" for unset vars) — otherwise
// `new URL("")` throws ERR_INVALID_URL during page-data collection.
const rawAppUrl = process.env.NEXTAUTH_URL?.trim();
const APP_URL = rawAppUrl ? rawAppUrl : "http://localhost:3000";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} | Your AI Guide to German Immigration`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  metadataBase: new URL(APP_URL),
  openGraph: {
    title: `${APP_NAME} | Your AI Guide to German Immigration`,
    description: APP_DESCRIPTION,
    type: "website",
    url: APP_URL,
    siteName: APP_NAME,
    locale: "en_IN",
    images: [
      {
        url: "/Images/hero-banner.jpg",
        width: 1200,
        height: 630,
        alt: "Behörden-Bot — your AI guide to German immigration",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} | Your AI Guide to German Immigration`,
    description: APP_DESCRIPTION,
    images: ["/Images/hero-banner.jpg"],
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
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <PreferenceProvider>
          <Providers>{children}</Providers>
        </PreferenceProvider>
      </body>
    </html>
  );
}
