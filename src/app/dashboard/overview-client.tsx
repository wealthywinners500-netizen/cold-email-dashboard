"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Inbox, Users, Activity } from "lucide-react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { DashboardMetrics } from "@/lib/supabase/types";

interface DashboardData {
  serverPairs: Array<{
    pair_number: number;
    status: string;
    warmup_day: number;
    total_accounts: number;
    mxtoolbox_errors: number;
  }>;
  campaigns: Array<{
    name: string;
    status: string;
    recipients: number;
  }>;
  leads: Array<{
    state: string;
    total_scraped: number;
    verified_count: number;
  }>;
  followUps: Array<any>;
  smsWorkflows: Array<any>;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  INTERESTED: "#22c55e",
  NOT_INTERESTED: "#6b7280",
  OBJECTION: "#eab308",
  AUTO_REPLY: "#3b82f6",
  BOUNCE: "#ef4444",
  STOP: "#f97316",
  SPAM: "#a855f7",
};

export default function OverviewClient({
  data,
  metrics,
}: {
  data: DashboardData;
  metrics: DashboardMetrics | null;
}) {
  // Leads by region (state)
  const leadsByRegion = data.leads
    .filter((l) => l.total_scraped > 0)
    .map((l) => ({
      region: l.state,
      leads: l.verified_count,
    }))
    .sort((a, b) => b.leads - a.leads);

  // Classification pie chart data
  const classificationData = metrics
    ? Object.entries(metrics.inbox.classification_breakdown).map(([name, value]) => ({
        name,
        value,
      }))
    : [];

  // Health indicator
  const healthColor = !metrics
    ? "bg-gray-500"
    : metrics.health === "green"
    ? "bg-green-500"
    : metrics.health === "yellow"
    ? "bg-yellow-500"
    : "bg-red-500";

  const healthLabel = !metrics
    ? "Loading..."
    : metrics.health === "green"
    ? "All systems operational"
    : metrics.health === "yellow"
    ? "Some systems degraded"
    : "Issues detected";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Dashboard Overview</h1>
        <p className="text-gray-400 mt-2">
          Real-time status of your cold email infrastructure
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Active Campaigns */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-white">
                {metrics?.active_campaigns.count ?? 0}
              </div>
            </div>
            {metrics && metrics.active_campaigns.total_recipients > 0 && (
              <>
                <div className="mt-3">
                  <Progress value={metrics.active_campaigns.percent_sent} className="h-2" />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {metrics.active_campaigns.percent_sent}% sent ({(metrics.active_campaigns.total_recipients ?? 0).toLocaleString()} recipients)
                </p>
              </>
            )}
            {(!metrics || metrics.active_campaigns.total_recipients === 0) && (
              <p className="text-sm text-gray-400 mt-3">No active sends</p>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Inbox Summary */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Inbox className="w-4 h-4" />
              Inbox
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-white">
                {metrics?.inbox.unread ?? 0}
              </div>
              <div className="text-sm text-gray-400">unread</div>
            </div>
            <p className="text-sm text-gray-400 mt-3">
              {metrics?.inbox.today_replies ?? 0} replies today
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Lead Database */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Lead Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-white">
                {(metrics?.leads.total_contacts ?? 0).toLocaleString()}
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-3">
              {metrics?.leads.verified_percent ?? 0}% verified
            </p>
            <div className="flex gap-1 mt-3 flex-wrap">
              {(metrics?.leads.top_cities || []).map((city) => (
                <Badge
                  key={city.city}
                  className="bg-cyan-900 text-cyan-200 text-xs"
                >
                  {city.city}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Card 4: System Health */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${healthColor}`} />
              <span className="text-white font-semibold capitalize">
                {metrics?.health ?? "unknown"}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-3">{healthLabel}</p>
            <Link
              href="/dashboard/admin"
              className="text-xs text-blue-400 hover:text-blue-300 mt-3 inline-block"
            >
              View details →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Classification Pie Chart */}
      {classificationData.length > 0 && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Reply Classifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={classificationData}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {classificationData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={
                          CLASSIFICATION_COLORS[entry.name] || "#6b7280"
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "0.5rem",
                    }}
                    labelStyle={{ color: "#f3f4f6" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3">
                {classificationData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2 text-sm">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          CLASSIFICATION_COLORS[entry.name] || "#6b7280",
                      }}
                    />
                    <span className="text-gray-300">
                      {entry.name}: {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leads by Region Chart */}
      {leadsByRegion.length > 0 && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Leads by Region</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={leadsByRegion}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="region" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: "0.5rem",
                  }}
                  labelStyle={{ color: "#f3f4f6" }}
                />
                <Bar dataKey="leads" fill="#3b82f6" name="Verified Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
