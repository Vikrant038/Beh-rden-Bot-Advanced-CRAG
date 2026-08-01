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

const CHART_COLORS = ["#6366f1", "#0ea5e9", "#16a34a", "#d97706", "#dc2626"];

interface DailyQueriesChartProps {
  data: DailyQueryPoint[];
}

export function DailyQueriesChart({ data }: DailyQueriesChartProps) {
  const points = data.map((point) => ({ ...point, label: formatRelativeDay(point.date) }));
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Queries per day</h3>
      <p className="mb-4 text-xs text-muted">User queries in the last 14 days</p>
      <div className="h-56">
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
      </div>
    </div>
  );
}

interface CacheDonutProps {
  cacheHitRate: number;
}

export function CacheDonut({ cacheHitRate }: CacheDonutProps) {
  const data = [
    { name: "Cache hits", value: cacheHitRate },
    { name: "Cache misses", value: Math.max(0, 1 - cacheHitRate) },
  ];
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Cache hits vs misses</h3>
      <p className="mb-4 text-xs text-muted">Semantic cache effectiveness</p>
      <div className="h-56">
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
      </div>
    </div>
  );
}

interface ModeSplitChartProps {
  data: ModeSplitPoint[];
}

export function ModeSplitChart({ data }: ModeSplitChartProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Engine mode split</h3>
      <p className="mb-4 text-xs text-muted">Standard vs agentic responses</p>
      <div className="h-56">
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
      </div>
    </div>
  );
}
