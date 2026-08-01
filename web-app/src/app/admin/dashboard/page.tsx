"use client";

import { Users, MessageSquare, Zap, Database } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { MetricCard } from "@/components/admin/metric-card";
import { DailyQueriesChart, CacheDonut, ModeSplitChart } from "@/components/admin/dashboard-charts";
import { RecentQueriesTable } from "@/components/admin/recent-queries-table";

export default function AdminDashboardPage() {
  const metrics = api.admin.metrics.useQuery();
  const dailyQueries = api.admin.dailyQueries.useQuery();
  const modeSplit = api.admin.modeSplit.useQuery();
  const recentQueries = api.admin.recentQueries.useQuery();

  const data = metrics.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Usage, cache health, and pipeline performance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total users"
          value={data?.totalUsers ?? 0}
          icon={Users}
          accent="primary"
        />
        <MetricCard
          label="Total messages"
          value={data?.totalMessages ?? 0}
          icon={MessageSquare}
          accent="accent"
        />
        <MetricCard
          label="Queries today"
          value={data?.queriesToday ?? 0}
          icon={Zap}
          accent="warning"
        />
        <MetricCard
          label="Avg latency"
          value={data?.avgLatencyMs ?? 0}
          format={(value) => `${Math.round(value)}ms`}
          icon={Database}
          accent="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyQueriesChart data={dailyQueries.data ?? []} />
        </div>
        <CacheDonut cacheHitRate={data?.cacheHitRate ?? 0} />
      </div>

      <ModeSplitChart data={modeSplit.data ?? []} />

      <RecentQueriesTable queries={recentQueries.data ?? []} loading={recentQueries.isLoading} />
    </div>
  );
}
