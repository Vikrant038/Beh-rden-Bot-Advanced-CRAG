"use client";

import { cn } from "@/lib/utils";

interface RadioGroupProps<T extends string | number> {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{
    value: T;
    /** Text or icon rendered inside the radio button. */
    label: React.ReactNode;
    ariaLabel?: string;
  }>;
  /** Accessible name for the group element. */
  label: string;
  className?: string;
  buttonClassName?: string;
}

/**
 * Segmented radio group used for view-mode / filter toggles
 * (source browser, document manager, pipeline tester).
 */
export function RadioGroup<T extends string | number>({
  value,
  onValueChange,
  options,
  label,
  className,
  buttonClassName,
}: RadioGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "grid place-items-center rounded-lg text-xs transition focus-visible:ring-2 focus-visible:ring-primary",
              buttonClassName,
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
