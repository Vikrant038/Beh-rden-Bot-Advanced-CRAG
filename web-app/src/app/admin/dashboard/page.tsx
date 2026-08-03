"use client";

import { useMemo, useState } from "react";
import { Database, MessageSquare, RefreshCw, Users, Zap } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { MetricCard } from "@/components/admin/metric-card";
import { DailyQueriesChart, CacheDonut, ModeSplitChart } from "@/components/admin/dashboard-charts";
import { RecentQueriesTable } from "@/components/admin/recent-queries-table";
import { TopQuestions } from "@/components/admin/top-questions";
import { FailedQueriesCard } from "@/components/admin/failed-queries-card";

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

const REFRESH_INTERVAL_MS = 60_000;

export default function AdminDashboardPage() {
  const [days, setDays] = useState(14);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const metrics = api.admin.metrics.useQuery(undefined, { refetchInterval: REFRESH_INTERVAL_MS });
  const dailyQueries = api.admin.dailyQueries.useQuery({ days });
  const modeSplit = api.admin.modeSplit.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const recentQueries = api.admin.recentQueries.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const topQuestions = api.admin.topQuestions.useQuery({ days });
  const failedQueries = api.admin.failedQueries.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const data = metrics.data;

  const trend = useMemo(() => {
    const points = dailyQueries.data ?? [];
    if (points.length < 4) {
      return null;
    }
    const mid = Math.floor(points.length / 2);
    const previous = points.slice(0, mid).reduce((sum, point) => sum + point.count, 0);
    const current = points.slice(mid).reduce((sum, point) => sum + point.count, 0);
    if (previous === 0) {
      return null;
    }
    return Math.round(((current - previous) / previous) * 100);
  }, [dailyQueries.data]);

  const refresh = () => {
    setManualRefreshing(true);
    void Promise.all([
      metrics.refetch(),
      dailyQueries.refetch(),
      modeSplit.refetch(),
      recentQueries.refetch(),
      topQuestions.refetch(),
      failedQueries.refetch(),
    ]).finally(() => setManualRefreshing(false));
  };

  const lastUpdated = useMemo(() => {
    return metrics.dataUpdatedAt > 0 ? new Date(metrics.dataUpdatedAt) : null;
  }, [metrics.dataUpdatedAt]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Usage, cache health, and pipeline performance ·{" "}
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          {lastUpdated ? (
            <p className="mt-0.5 text-[10px] text-muted">
              Last updated {lastUpdated.toLocaleTimeString()} · auto-refreshes every 60s
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Dashboard time range"
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
          >
            {RANGES.map((option) => (
              <button
                key={option.days}
                type="button"
                role="radio"
                aria-checked={days === option.days}
                onClick={() => setDays(option.days)}
                className={`rounded-lg px-3 py-1.5 text-xs transition focus-visible:ring-2 focus-visible:ring-primary ${
                  days === option.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={manualRefreshing}
            aria-label="Refresh dashboard"
            title="Refresh now"
            className="grid h-10 w-10 place-items-center rounded-xl border border-border text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${manualRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total users"
          value={data?.totalUsers ?? 0}
          icon={Users}
          accent="primary"
          loading={metrics.isLoading}
        />
        <MetricCard
          label="Total messages"
          value={data?.totalMessages ?? 0}
          icon={MessageSquare}
          accent="accent"
          loading={metrics.isLoading}
        />
        <MetricCard
          label="Queries today"
          value={data?.queriesToday ?? 0}
          icon={Zap}
          accent="warning"
          trend={trend}
          trendLabel="vs previous period"
          loading={metrics.isLoading}
        />
        <MetricCard
          label="Avg latency"
          value={data?.avgLatencyMs ?? 0}
          format={(value) => `${Math.round(value)}ms`}
          icon={Database}
          accent="success"
          loading={metrics.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyQueriesChart data={dailyQueries.data ?? []} loading={dailyQueries.isLoading} />
        </div>
        <CacheDonut cacheHitRate={data?.cacheHitRate ?? 0} loading={metrics.isLoading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ModeSplitChart data={modeSplit.data ?? []} loading={modeSplit.isLoading} />
        <TopQuestions queries={topQuestions.data ?? []} loading={topQuestions.isLoading} />
      </div>

      <FailedQueriesCard queries={failedQueries.data ?? []} loading={failedQueries.isLoading} />

      <RecentQueriesTable
        queries={recentQueries.data ?? []}
        loading={recentQueries.isLoading}
      />
    </div>
  );
}
