"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw, Mail, Server, Zap } from "lucide-react";
import type { SystemHealth, SystemAlert } from "@/lib/supabase/types";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-900 text-red-200",
    warning: "bg-yellow-900 text-yellow-200",
    info: "bg-blue-900 text-blue-200",
  };
  return <Badge className={colors[severity] || "bg-gray-700 text-gray-300"}>{severity}</Badge>;
}

export default function SystemHealthClient() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [healthRes, alertsRes] = await Promise.all([
        fetch("/api/system-health"),
        fetch("/api/system-alerts?acknowledged=false"),
      ]);
      if (healthRes.ok) setHealth(await healthRes.json());
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data.alerts || []);
      }
    } catch (err) {
      console.error("Failed to fetch system health:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch("/api/system-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      });
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!health) {
    return <p className="text-gray-400">Failed to load system health data.</p>;
  }

  const errorRate = health.worker.jobs_today > 0
    ? ((health.worker.errors_today / health.worker.jobs_today) * 100).toFixed(1)
    : "0.0";

  const workerStatus = !health.worker.is_healthy
    ? { label: "Down", color: "text-red-400", dot: "bg-red-500" }
    : parseFloat(errorRate) > 5
    ? { label: "Degraded", color: "text-yellow-400", dot: "bg-yellow-500" }
    : { label: "Healthy", color: "text-green-400", dot: "bg-green-500" };

  const bounceColor = health.delivery.bounce_rate > 5
    ? "text-red-400"
    : health.delivery.bounce_rate > 2
    ? "text-yellow-400"
    : "text-green-400";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">System Health</h2>
        <button
          onClick={() => fetchData(true)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Worker Status */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Worker Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${workerStatus.dot}`} />
              <span className={`font-semibold ${workerStatus.color}`}>{workerStatus.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-400">Last Heartbeat</p>
                <p className="text-white">{timeAgo(health.worker.last_heartbeat)}</p>
              </div>
              <div>
                <p className="text-gray-400">Jobs Today</p>
                <p className="text-white">{(health.worker.jobs_today ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400">Error Rate</p>
                <p className="text-white">{errorRate}%</p>
              </div>
              <div>
                <p className="text-gray-400">Errors Today</p>
                <p className="text-white">{health.worker.errors_today ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Email Accounts */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Email Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold text-white">{health.email_accounts.total}</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-400">Syncing</p>
                <p className="text-green-400 font-semibold">{health.email_accounts.syncing}</p>
              </div>
              <div>
                <p className="text-gray-400">Errored</p>
                <p className={`font-semibold ${health.email_accounts.errored > 0 ? "text-yellow-400" : "text-gray-500"}`}>
                  {health.email_accounts.errored}
                </p>
              </div>
              <div>
                <p className="text-gray-400">Disabled</p>
                <p className={`font-semibold ${health.email_accounts.disabled > 0 ? "text-red-400" : "text-gray-500"}`}>
                  {health.email_accounts.disabled}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delivery Stats */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Delivery Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-sm">Sent Today</p>
                <p className="text-2xl font-bold text-white">{(health.delivery.sent_today ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Bounce Rate</p>
                <p className={`text-2xl font-bold ${bounceColor}`}>{(health.delivery.bounce_rate ?? 0).toFixed(1)}%</p>
              </div>
            </div>
            <div className="text-sm">
              <p className="text-gray-400">Suppressed: <span className="text-white">{(health.delivery.suppressed_total ?? 0).toLocaleString()}</span></p>
            </div>
          </CardContent>
        </Card>

        {/* Queue Depth */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Server className="w-4 h-4" />
              Queue Depth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-sm">Pending</p>
                <p className="text-2xl font-bold text-white">{(health.queue.pending ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-400 text-sm">Failed</p>
                <p className={`text-2xl font-bold ${(health.queue.failed ?? 0) > 0 ? "text-red-400" : "text-gray-500"}`}>
                  {(health.queue.failed ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Alerts Table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            System Alerts
            {alerts.length > 0 && (
              <Badge className="bg-red-900 text-red-200 ml-2">{alerts.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-gray-400 py-4">
              <CheckCircle className="w-5 h-5 text-green-400" />
              No unacknowledged alerts
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-400 py-2 pr-4">Time</th>
                    <th className="text-left text-gray-400 py-2 pr-4">Severity</th>
                    <th className="text-left text-gray-400 py-2 pr-4">Type</th>
                    <th className="text-left text-gray-400 py-2 pr-4">Title</th>
                    <th className="text-right text-gray-400 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id} className="border-b border-gray-800/50">
                      <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">{timeAgo(alert.created_at)}</td>
                      <td className="py-3 pr-4"><SeverityBadge severity={alert.severity} /></td>
                      <td className="py-3 pr-4 text-gray-300">{alert.alert_type.replace(/_/g, " ")}</td>
                      <td className="py-3 pr-4 text-white">{alert.title}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Acknowledge
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
