import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/lib/trpc/provider";

const APP_NAME = "Behörden-Bot";
const APP_DESCRIPTION =
  "AI assistant for German student visa, APS certification, university applications, blocked accounts, and immigration questions — built for Indian students.";
const APP_URL = "https://behoerden-bot.vercel.app";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
