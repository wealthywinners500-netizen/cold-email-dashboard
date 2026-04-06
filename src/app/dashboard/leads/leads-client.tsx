"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Filter } from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Lead {
  id: string;
  org_id: string;
  source: string;
  city: string;
  state: string;
  total_scraped: number;
  verified_count: number;
  cost_per_lead: number;
  status: "verified" | "pending" | "submitted" | "completed";
  created_at: string;
}

interface LeadsClientProps {
  leads: Lead[];
}

export default function LeadsClient({ leads }: LeadsClientProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const safeLeads = useMemo(() => leads.map(l => ({
    ...l,
    total_scraped: l.total_scraped ?? 0,
    verified_count: l.verified_count ?? 0,
    cost_per_lead: l.cost_per_lead ?? 0,
  })), [leads]);

  const filteredLeads = useMemo(() => {
    if (selectedStatus === "all") return safeLeads;
    return safeLeads.filter((lead) => lead.status === selectedStatus);
  }, [safeLeads, selectedStatus]);

  const metrics = useMemo(() => {
    const totalScraped = filteredLeads.reduce((sum, l) => sum + l.total_scraped, 0);
    const totalVerified = filteredLeads.reduce((sum, l) => sum + l.verified_count, 0);
    const totalCost = filteredLeads.reduce(
      (sum, l) => sum + l.verified_count * l.cost_per_lead,
      0
    );
    const blendedCostPerLead =
      totalVerified > 0 ? (totalCost / totalVerified).toFixed(4) : "0.0000";
    const avgVerificationRate =
      filteredLeads.length > 0
        ? (
            filteredLeads.reduce((sum, l) => {
              if (l.total_scraped === 0) return sum;
              return sum + (l.verified_count / l.total_scraped) * 100;
            }, 0) / filteredLeads.length
          ).toFixed(2)
        : "0.00";
    const activeScrapes = filteredLeads.filter(
      (l) => l.status === "pending" || l.status === "submitted"
    ).length;

    return {
      totalScraped,
      blendedCostPerLead,
      avgVerificationRate,
      activeScrapes,
    };
  }, [filteredLeads]);

  const leadsByRegion = useMemo(() => {
    const regionMap: Record<string, number> = {};
    filteredLeads.forEach((lead) => {
      const state = lead.state || "Unknown";
      regionMap[state] = (regionMap[state] || 0) + lead.total_scraped;
    });
    return Object.entries(regionMap)
      .map(([state, count]) => ({ name: state, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLeads]);

  const costDistribution = useMemo(() => {
    return filteredLeads
      .filter((l) => l.cost_per_lead > 0)
      .map((lead) => ({
        name: `${lead.city}, ${lead.state}`,
        value: parseFloat(
          (lead.verified_count * lead.cost_per_lead).toFixed(2)
        ),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredLeads]);

  const statusColors: Record<string, string> = {
    verified: "#10b981",
    pending: "#fbbf24",
    submitted: "#fbbf24",
    completed: "#3b82f6",
  };

  const statusBadgeVariants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    verified: "default",
    pending: "secondary",
    submitted: "secondary",
    completed: "outline",
  };

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Lead Pipeline</h1>
          <p className="text-gray-400 mt-2">
            Manage and track lead sources and verification
          </p>
        </div>
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
          <Users className="w-5 h-5 inline mr-2" />
          Import Leads
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Leads Scraped
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.totalScraped.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Blended Cost/Lead
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              ${metrics.blendedCostPerLead}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Avg Verification Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.avgVerificationRate}%
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Scrapes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.activeScrapes}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white">Lead Batches</CardTitle>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1 text-sm"
            >
              <option value="all">All Status</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400">
                    Location
                  </th>
                  <th className="text-left py-3 px-4 text-gray-400">Source</th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Scraped
                  </th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Verified
                  </th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Cost/Lead
                  </th>
                  <th className="text-left py-3 px-4 text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-3 px-4 text-white font-medium">
                      {lead.city}, {lead.state}
                    </td>
                    <td className="py-3 px-4 text-gray-400">{lead.source}</td>
                    <td className="py-3 px-4 text-white text-right">
                      {lead.total_scraped.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      {lead.verified_count.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      ${lead.cost_per_lead.toFixed(4)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={statusBadgeVariants[lead.status]}>
                        {lead.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Leads by Region</CardTitle>
          </CardHeader>
          <CardContent>
            {leadsByRegion.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={leadsByRegion}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: "#9ca3af" }} />
                  <YAxis tick={{ fill: "#9ca3af" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" name="Leads Scraped" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-80 text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Cost Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {costDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={costDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: $${entry.value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {costDistribution.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={colors[index % colors.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                      color: "#fff",
                    }}
                    formatter={(value) => `$${(value as number).toFixed(2)}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-80 text-gray-400">
                No cost data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Quality Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-white font-medium">Verification Rate by Source</h3>
              {filteredLeads.map((lead) => {
                const rate =
                  lead.total_scraped > 0
                    ? (
                        (lead.verified_count / lead.total_scraped) *
                        100
                      ).toFixed(1)
                    : "0.0";
                return (
                  <div key={lead.id} className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">
                      {lead.city}, {lead.state}
                    </span>
                    <span className="text-white font-medium">{rate}%</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-4">
              <h3 className="text-white font-medium">Status Summary</h3>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Verified</span>
                <span className="text-white font-medium">
                  {filteredLeads.filter((l) => l.status === "verified").length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Pending</span>
                <span className="text-white font-medium">
                  {filteredLeads.filter((l) => l.status === "pending").length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Submitted</span>
                <span className="text-white font-medium">
                  {filteredLeads.filter((l) => l.status === "submitted").length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Completed</span>
                <span className="text-white font-medium">
                  {filteredLeads.filter((l) => l.status === "completed").length}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
