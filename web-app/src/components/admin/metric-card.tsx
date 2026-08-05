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
  /** 9.3 — Sparkline series (e.g. daily query counts). Renders a tiny inline SVG. */
  sparkline?: number[];
  loading?: boolean;
}

/**
 * 9.3 — Lightweight inline SVG sparkline (no chart library needed for a 100×28
 * glyph). Normalizes the series to the viewBox and strokes a smooth path.
 */
function Sparkline({ data, accent }: { data: number[]; accent: string }) {
  const width = 100;
  const height = 28;
  if (data.length < 2) {
    return null;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-7 w-full"
      role="img"
      aria-label="Sparkline of recent values"
      preserveAspectRatio="none"
    >
      <polygon points={areaPoints} fill={accent} opacity="0.12" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ACCENT_CLASSES: Record<NonNullable<MetricCardProps["accent"]>, string> = {
  primary: "text-primary",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
};

const ACCENT_HEX: Record<NonNullable<MetricCardProps["accent"]>, string> = {
  primary: "#5b74e8",
  accent: "#0e7490",
  success: "#15803d",
  warning: "#b45309",
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
  sparkline,
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
      {!loading && sparkline && sparkline.length > 0 ? (
        <div className="mt-2">
          <Sparkline data={sparkline} accent={ACCENT_HEX[accent]} />
        </div>
      ) : null}
      {!loading && typeof trend === "number" ? (
        <p className="mt-1 flex items-center gap-1 text-xs">
          <TrendIcon className={`h-3.5 w-3.5 ${trendUp ? "text-success" : "text-destructive"}`} />
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
