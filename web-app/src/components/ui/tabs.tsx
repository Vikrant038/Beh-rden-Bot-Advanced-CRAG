"use client";

import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{
    value: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
  }>;
  className?: string;
}

export function Tabs({ value, onValueChange, items, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
