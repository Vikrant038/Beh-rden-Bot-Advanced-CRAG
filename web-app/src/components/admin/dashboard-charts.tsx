"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import type { DailyQueryPoint, ModeSplitPoint } from "@/server/routers/admin";
import { formatRelativeDay } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/trpc/client";
import { useToast } from "@/lib/toast";

/**
 * 11.14 — Color-blind safe palette (Okabe-Ito). The previous set
 * (#6366f1/#0ea5e9/#16a34a/#d97706/#dc2626) is indistinguishable for common
 * red-green and blue-yellow color vision deficiencies. Okabe-Ito is the
 * de-facto standard for accessible scientific figures. Pattern fills on every
 * second series add texture differentiation for total color-blindness.
 */
const CHART_COLORS = ["#0072B2", "#D55E00", "#009E73", "#E69F00", "#56B4E9", "#CC79A7"];

/** Diagonal hatch pattern for texture differentiation (11.14). */
function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="transparent" />
      <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.4" />
    </pattern>
  );
}

function cellFill(index: number, prefix: string): string {
  const color = CHART_COLORS[index % CHART_COLORS.length];
  // Alternate solid and hatched fills so the two series remain distinguishable
  // even under total color blindness.
  return index % 2 === 1 ? `url(#${prefix}-${index % CHART_COLORS.length})` : color;
}

/* ─── Shared shell ─────────────────────────────────────────── */

interface ChartShellProps {
  title: string;
  subtitle: string;
  loading: boolean;
  empty: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}

function ChartShell({
  title,
  subtitle,
  loading,
  empty,
  emptyMessage = "No data in this period yet.",
  children,
}: ChartShellProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-4 text-xs text-muted">{subtitle}</p>
      {loading ? (
        <Skeleton className="h-56 w-full" />
      ) : empty ? (
        <div className="grid h-56 place-items-center rounded-xl border border-dashed border-border text-sm text-muted">
          {emptyMessage}
        </div>
      ) : (
        <div className="h-56">{children}</div>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "var(--shadow-glass)",
} as const;

/* ─── 9.8 — Rich tooltip content ───────────────────────────── */

/**
 * 9.8 — Date + count + day-over-day % change + average. `series` is the full
 * point list so the change can be computed.
 */
function DailyTooltipWithTrend({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  series: DailyQueryPoint[];
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const value = Number(payload[0]?.value ?? 0);
  // The tooltip label is the formatted day string (formatRelativeDay), so match
  // against the same formatting to find the point's position in the series.
  const index = series.findIndex((point) => formatRelativeDay(point.date) === label);
  const previous = index > 0 ? series[index - 1]?.count : null;
  const change =
    previous !== null && previous !== 0 ? Math.round(((value - previous) / previous) * 100) : null;
  const average =
    series.length > 0 ? Math.round(series.reduce((sum, p) => sum + p.count, 0) / series.length) : 0;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-glass" role="status">
      <p className="text-xs font-semibold">{label}</p>
      <div className="mt-1 space-y-0.5 text-xs">
        <p className="tabular-nums">
          {value} queries
          {change !== null ? (
            <span
              className={`ml-1.5 font-medium tabular-nums ${
                change >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {change >= 0 ? "▲" : "▼"} {Math.abs(change)}%
            </span>
          ) : null}
        </p>
        <p className="text-muted">avg {average}/day</p>
      </div>
    </div>
  );
}

/**
 * 9.8 — Mode split tooltip: count + share of total, using a color-blind safe
 * legend dot instead of relying on hue alone.
 */
function ModeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const total = payload.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0);
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-glass" role="status">
      {payload.map((entry, index) => {
        const value = Number(entry.value ?? 0);
        const share = total > 0 ? Math.round((value / total) * 100) : 0;
        return (
          <p key={index} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="capitalize">{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {value} ({share}%)
            </span>
          </p>
        );
      })}
    </div>
  );
}

/* ─── Daily queries line chart ─────────────────────────────── */

interface DailyQueriesChartProps {
  data: DailyQueryPoint[];
  loading?: boolean;
}

export function DailyQueriesChart({ data, loading = false }: DailyQueriesChartProps) {
  const points = data.map((point) => ({ ...point, label: formatRelativeDay(point.date) }));
  return (
    <ChartShell
      title="Queries per day"
      subtitle="User queries in the selected window"
      loading={loading}
      empty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-muted)" }} allowDecimals={false} />
          <Tooltip
            content={(props) => (
              <DailyTooltipWithTrend
                active={props.active}
                payload={(props.payload as unknown) as Array<{ value: number }>}
                label={props.label as string | undefined}
                series={data}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            dot={false}
            name="Queries"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/* ─── Cache donut + health gauge (9.11) ────────────────────── */

const CACHE_GAUGE_BANDS = [
  { min: 0.6, label: "Healthy", color: "#15803d" },
  { min: 0.3, label: "Fair", color: "#b45309" },
  { min: 0, label: "Poor", color: "#b91c1c" },
] as const;

interface CacheDonutProps {
  cacheHitRate: number;
  loading?: boolean;
}

export function CacheDonut({ cacheHitRate, loading = false }: CacheDonutProps) {
  const utils = api.useUtils();
  const { toast } = useToast();
  const clearCacheMutation = api.admin.clearCache.useMutation();
  const [confirmClear, setConfirmClear] = useState(false);

  const percent = Math.round(cacheHitRate * 100);
  const band =
    CACHE_GAUGE_BANDS.find((b) => cacheHitRate >= b.min) ?? CACHE_GAUGE_BANDS[2];
  const data = [
    { name: "Cache hits", value: cacheHitRate },
    { name: "Cache misses", value: Math.max(0, 1 - cacheHitRate) },
  ];

  const handleClear = () => {
    clearCacheMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Semantic cache cleared", variant: "success" });
        void utils.admin.metrics.invalidate();
      },
      onError: () => toast({ title: "Could not clear cache", variant: "error" }),
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">Cache health</h3>
          <p className="mb-4 text-xs text-muted">Semantic cache effectiveness</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={loading || clearCacheMutation.isPending}
          className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-medium text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
        >
          {clearCacheMutation.isPending ? "Clearing…" : "Clear cache"}
        </button>
      </div>
      {loading ? (
        <Skeleton className="h-56 w-full" />
      ) : cacheHitRate === 0 ? (
        <div className="grid h-56 place-items-center rounded-xl border border-dashed border-border text-sm text-muted">
          No cache activity yet.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={176}>
            <PieChart>
              <defs>
                <HatchPattern id="cache-hatch" color={CHART_COLORS[1]} />
              </defs>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={76}
                paddingAngle={4}
                stroke="none"
              >
                <Cell fill={CHART_COLORS[0]} />
                <Cell fill="url(#cache-hatch)" />
              </Pie>
              <Tooltip
                formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* 9.11 — Color-coded threshold gauge */}
          <div className="mt-3" role="img" aria-label={`Cache health: ${band.label} (${percent}%)`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium" style={{ color: band.color }}>
                {band.label}
              </span>
              <span className="text-muted tabular-nums">{percent}% hit rate</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${percent}%`, background: band.color }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              ≥60% healthy · 30–59% fair · &lt;30% poor
            </p>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear semantic cache?"
        description="All cached answers will be evicted and the next matching queries will run the full pipeline again. This cannot be undone."
        confirmLabel="Clear cache"
        isPending={clearCacheMutation.isPending}
        onConfirm={() => {
          setConfirmClear(false);
          handleClear();
        }}
      />
    </div>
  );
}

/* ─── Engine mode split bar chart ──────────────────────────── */

interface ModeSplitChartProps {
  data: ModeSplitPoint[];
  loading?: boolean;
}

export function ModeSplitChart({ data, loading = false }: ModeSplitChartProps) {
  return (
    <ChartShell
      title="Engine mode split"
      subtitle="Standard vs agentic responses"
      loading={loading}
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {CHART_COLORS.map((color, index) => (
              <HatchPattern key={color} id={`mode-hatch-${index}`} color={color} />
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="mode"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            tickFormatter={(value: string) => value.toUpperCase()}
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-muted)" }} allowDecimals={false} />
          <Tooltip content={<ModeTooltip />} />
          <Bar dataKey="count" name="Responses" radius={[6, 6, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={entry.mode} fill={cellFill(index, "mode-hatch")} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
