"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricCardProps {
  label: string;
  value: number;
  format?: (value: number) => string;
  icon: LucideIcon;
  accent?: "primary" | "accent" | "success" | "warning";
  trend?: number | null;
  trendLabel?: string;
  loading?: boolean;
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
  trend,
  trendLabel = "vs previous period",
  loading = false,
}: MetricCardProps) {
  const animated = useAnimatedCount(value);
  const display = format ? format(animated) : animated.toLocaleString();

  const trendUp = (trend ?? 0) >= 0;
  const TrendIcon = trendUp ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <Icon className={`h-4 w-4 ${ACCENT_CLASSES[accent]}`} />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tabular-nums">{display}</p>
      )}
      {!loading && typeof trend === "number" ? (
        <p className="mt-1 flex items-center gap-1 text-xs">
          <TrendIcon
            className={`h-3.5 w-3.5 ${trendUp ? "text-success" : "text-destructive"}`}
          />
          <span
            className={`font-medium tabular-nums ${trendUp ? "text-success" : "text-destructive"}`}
          >
            {trendUp ? "+" : ""}
            {trend}%
          </span>
          <span className="text-muted">{trendLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
