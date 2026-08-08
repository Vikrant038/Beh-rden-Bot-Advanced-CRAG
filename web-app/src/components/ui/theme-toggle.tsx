"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

/** Light / Dark / System switch. Defaults to system, persists to localStorage. */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = mounted ? (resolvedTheme === "dark" ? "dark" : "light") : "dark";

  if (compact) {
    return (
      <button
        type="button"
        aria-label={`Switch to ${current === "dark" ? "light" : "dark"} mode`}
        onClick={() => setTheme(current === "dark" ? "light" : "dark")}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
      >
        {mounted ? (
          current === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = mounted ? resolvedTheme === option.value : option.value === "dark";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary",
              active
                ? "brand-gradient text-white shadow-[0_4px_14px_-4px_var(--color-primary)]"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <option.icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
