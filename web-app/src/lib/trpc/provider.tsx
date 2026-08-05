"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { api } from "@/lib/trpc/client";
import { ToastProvider } from "@/lib/toast";
import { CommandPalette } from "@/components/ui/command-palette";

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /**
   * Per-request CSP nonce (from middleware's x-nonce header). next-themes
   * injects an inline <script> for the theme bootstrap; without the nonce
   * the strict CSP blocks it (theme flash + a console CSP violation).
   */
  nonce?: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [httpBatchLink({ url: "/api/trpc" })],
    }),
  );

  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem nonce={nonce}>
        <ToastProvider>
          <api.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
              {children}
              <CommandPalette />
            </QueryClientProvider>
          </api.Provider>
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
