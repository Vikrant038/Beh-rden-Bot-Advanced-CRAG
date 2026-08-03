"use client";

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
  Legend,
} from "recharts";
import type { DailyQueryPoint, ModeSplitPoint } from "@/server/routers/admin";
import { formatRelativeDay } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const CHART_COLORS = ["#6366f1", "#0ea5e9", "#16a34a", "#d97706", "#dc2626"];

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
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            name="Queries"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

interface CacheDonutProps {
  cacheHitRate: number;
  loading?: boolean;
}

export function CacheDonut({ cacheHitRate, loading = false }: CacheDonutProps) {
  const data = [
    { name: "Cache hits", value: cacheHitRate },
    { name: "Cache misses", value: Math.max(0, 1 - cacheHitRate) },
  ];
  return (
    <ChartShell
      title="Cache hits vs misses"
      subtitle="Semantic cache effectiveness"
      loading={loading}
      empty={cacheHitRate === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={80}
            paddingAngle={4}
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="mode"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            tickFormatter={(value: string) => value.toUpperCase()}
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-muted)" }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" name="Responses" radius={[6, 6, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={entry.mode} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
