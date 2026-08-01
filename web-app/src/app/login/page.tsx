"use client";

import { signIn } from "next-auth/react";
import { AtSign, GitBranch } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-2xl">
        <h1 className="text-xl font-semibold">Welcome to Behörden-Bot</h1>
        <p className="mt-1 text-sm text-muted">
          Your AI guide to German immigration, student visas, APS certification, and university
          applications.
        </p>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => void signIn("github", { callbackUrl: "/chat" })}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-hover"
          >
            <GitBranch className="h-4 w-4" />
            Continue with GitHub
          </button>
          <button
            type="button"
            onClick={() => void signIn("google", { callbackUrl: "/chat" })}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            <AtSign className="h-4 w-4" />
            Continue with Google
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Signing in grants access to your personal conversation history.
        </p>
      </div>
    </div>
  );
}
