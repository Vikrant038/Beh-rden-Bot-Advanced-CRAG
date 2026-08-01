"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: number;
  format?: (value: number) => string;
  icon: LucideIcon;
  accent?: "primary" | "accent" | "success" | "warning";
}

const ACCENT_CLASSES: Record<NonNullable<MetricCardProps["accent"]>, string> = {
  primary: "text-primary",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
};

function useAnimatedCount(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}

export function MetricCard({
  label,
  value,
  format,
  icon: Icon,
  accent = "primary",
}: MetricCardProps) {
  const animated = useAnimatedCount(value);
  const display = format ? format(animated) : animated.toLocaleString();

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <Icon className={`h-4 w-4 ${ACCENT_CLASSES[accent]}`} />
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{display}</p>
    </div>
  );
}
