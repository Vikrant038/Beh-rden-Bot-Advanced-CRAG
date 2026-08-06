"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { AtSign, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type OAuthProvider = "github" | "google";

const PROVIDERS: Array<{
  id: OAuthProvider;
  label: string;
  icon: typeof GitBranch;
  className?: string;
}> = [
  {
    id: "github",
    label: "Continue with GitHub",
    icon: GitBranch,
  },
  {
    id: "google",
    label: "Continue with Google",
    icon: AtSign,
    className: "bg-primary text-white hover:bg-primary-hover",
  },
];

/**
 * OAuth sign-in buttons with per-provider loading state. While one provider
 * is authenticating both buttons are disabled so the user can't double-submit.
 */
export function OAuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);

  const handleSignIn = (provider: OAuthProvider) => {
    setPendingProvider(provider);
    void signIn(provider, { redirectTo: "/chat" });
  };

  return (
    <div className="space-y-3">
      {PROVIDERS.map((provider) => {
        const Icon = provider.icon;
        const isPending = pendingProvider === provider.id;
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => handleSignIn(provider.id)}
            disabled={pendingProvider !== null}
            className={cn(
              "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
              provider.className,
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
            {isPending ? "Redirecting…" : provider.label}
          </button>
        );
      })}
    </div>
  );
}
