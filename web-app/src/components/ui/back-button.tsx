"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  /** Where to go. Defaults to router.back() when omitted. */
  href?: string;
  label?: string;
}

/**
 * Slim back-navigation button used at the top of inner pages
 * (History, Settings, Sources, etc.).
 * Uses router.back() by default so the browser history is respected;
 * pass an explicit href as a fallback for direct-link landings.
 */
export function BackButton({ href, label = "Back" }: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (href) {
      router.push(href);
    } else {
      router.back();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="group sticky top-2 z-30 mb-5 inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/90 px-2 py-1.5 text-sm text-muted shadow-sm backdrop-blur transition hover:bg-surface-hover hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      {label}
    </button>
  );
}
