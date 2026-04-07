"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Filter } from "lucide-react";
import CreateCampaignModal from "@/components/modals/create-campaign-modal";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
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
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Campaign {
  id: string;
  org_id: string;
  snovio_id: string;
  name: string;
  region: string;
  store_chain: string;
  recipients: number;
  open_rate: number;
  reply_rate: number;
  bounce_rate: number;
  status: "active" | "paused" | "completed" | "sending";
  total_sent?: number;
  total_recipients?: number;
  created_at: string;
}

interface CampaignsClientProps {
  campaigns: Campaign[];
}

export default function CampaignsClient({ campaigns }: CampaignsClientProps) {
  const [selectedRegion, setSelectedRegion] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<any>(null);
  useRealtimeRefresh("campaigns");

  const regions = useMemo(() => {
    const unique = new Set(campaigns.map((c) => c.region));
    return ["All", ...Array.from(unique).sort()];
  }, [campaigns]);

  if (campaigns.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Campaigns</h1>
          <p className="text-gray-400 mt-2">Manage email campaigns and track performance</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Mail className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No campaigns yet</h3>
          <p className="text-gray-400 mb-6 max-w-md">Create your first email campaign to start reaching prospects.</p>
          <button
            onClick={() => {
              setEditingCampaign(null);
              setModalOpen(true);
            }}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            Create Campaign
          </button>
        </div>
        <CreateCampaignModal open={modalOpen} onOpenChange={setModalOpen} editData={editingCampaign} />
      </div>
    );
  }

  const filteredCampaigns = useMemo(() => {
    return campaigns.map(c => ({
      ...c,
      recipients: c.recipients ?? 0,
      open_rate: c.open_rate ?? 0,
      reply_rate: c.reply_rate ?? 0,
      bounce_rate: c.bounce_rate ?? 0,
    })).filter((campaign) => {
      const regionMatch =
        selectedRegion === "All" || campaign.region === selectedRegion;
      const statusMatch =
        selectedStatus === "All" || campaign.status === selectedStatus;
      return regionMatch && statusMatch;
    });
  }, [campaigns, selectedRegion, selectedStatus]);

  const metrics = useMemo(() => {
    const totalCampaigns = filteredCampaigns.length;
    const totalRecipients = filteredCampaigns.reduce(
      (sum, c) => sum + c.recipients,
      0
    );
    const avgReplyRate =
      filteredCampaigns.length > 0
        ? (
            filteredCampaigns.reduce((sum, c) => sum + c.reply_rate, 0) /
            filteredCampaigns.length
          ).toFixed(2)
        : "0.00";
    const avgBounceRate =
      filteredCampaigns.length > 0
        ? (
            filteredCampaigns.reduce((sum, c) => sum + c.bounce_rate, 0) /
            filteredCampaigns.length
          ).toFixed(2)
        : "0.00";

    return {
      totalCampaigns,
      totalRecipients,
      avgReplyRate,
      avgBounceRate,
    };
  }, [filteredCampaigns]);

  const chartData = useMemo(() => {
    return filteredCampaigns
      .filter(
        (c) =>
          c.open_rate > 0 || c.reply_rate > 0 || c.bounce_rate > 0
      )
      .map((c) => ({
        name: c.name.substring(0, 20),
        "Open Rate": parseFloat(c.open_rate.toFixed(1)),
        "Reply Rate": parseFloat(c.reply_rate.toFixed(1)),
        "Bounce Rate": parseFloat(c.bounce_rate.toFixed(1)),
      }));
  }, [filteredCampaigns]);

  const statusDistribution = useMemo(() => {
    const distribution: Record<string, number> = {
      active: 0,
      paused: 0,
      completed: 0,
    };
    filteredCampaigns.forEach((c) => {
      distribution[c.status]++;
    });
    return Object.entries(distribution)
      .map(([status, count]) => ({ name: status, value: count }))
      .filter((item) => item.value > 0);
  }, [filteredCampaigns]);

  const statusColors: Record<string, string> = {
    active: "#10b981",
    paused: "#6b7280",
    completed: "#3b82f6",
  };

  const statusBadgeVariants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    active: "default",
    paused: "secondary",
    completed: "outline",
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Campaigns</h1>
          <p className="text-gray-400 mt-2">
            Manage email campaigns and track performance
          </p>
        </div>
        <button
          onClick={() => {
            setEditingCampaign(null);
            setModalOpen(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
        >
          <Mail className="w-5 h-5 inline mr-2" />
          Create Campaign
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.totalCampaigns}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Recipients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.totalRecipients.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Avg Reply Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.avgReplyRate}%
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Avg Bounce Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {metrics.avgBounceRate}%
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Campaign Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#9ca3af" }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis tick={{ fill: "#9ca3af" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Legend />
                  <Bar dataKey="Open Rate" fill="#3b82f6" />
                  <Bar dataKey="Reply Rate" fill="#10b981" />
                  <Bar dataKey="Bounce Rate" fill="#ef4444" />
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
            <CardTitle className="text-white">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistribution.map((entry) => (
                      <Cell
                        key={`cell-${entry.name}`}
                        fill={statusColors[entry.name] || "#6b7280"}
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
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-80 text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-white">All Campaigns</CardTitle>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1 text-sm"
              >
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1 text-sm"
              >
                <option value="All">All Status</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400">
                    Campaign
                  </th>
                  <th className="text-left py-3 px-4 text-gray-400">Region</th>
                  <th className="text-left py-3 px-4 text-gray-400">
                    Store Chain
                  </th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Recipients
                  </th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Open Rate
                  </th>
                  <th className="text-right py-3 px-4 text-gray-400">
                    Reply Rate
                  </th>
                  <th className="text-left py-3 px-4 text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    onClick={() => {
                      setEditingCampaign(campaign);
                      setModalOpen(true);
                    }}
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                  >
                    <td className="py-3 px-4 text-white font-medium">
                      {campaign.name}
                    </td>
                    <td className="py-3 px-4 text-gray-400">{campaign.region}</td>
                    <td className="py-3 px-4 text-gray-400">
                      {campaign.store_chain}
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      {campaign.recipients.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      {campaign.open_rate.toFixed(2)}%
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      {campaign.reply_rate.toFixed(2)}%
                    </td>
                    <td className="py-3 px-4">
                      {campaign.status === "sending" && (campaign.total_recipients ?? 0) > 0 ? (
                        <div className="space-y-1">
                          <Badge variant={statusBadgeVariants[campaign.status] || "default"}>
                            sending
                          </Badge>
                          <div className="w-24 bg-gray-700 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(100, Math.round(((campaign.total_sent ?? 0) / (campaign.total_recipients ?? 1)) * 100))}%`,
                              }}
                            />
                          </div>
                          <p className="text-xs text-gray-400">
                            {Math.round(((campaign.total_sent ?? 0) / (campaign.total_recipients ?? 1)) * 100)}%
                          </p>
                        </div>
                      ) : (
                        <Badge variant={statusBadgeVariants[campaign.status]}>
                          {campaign.status}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {filteredCampaigns.filter((c) => c.status === "active").length}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Paused Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {filteredCampaigns.filter((c) => c.status === "paused").length}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Completed Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {filteredCampaigns.filter((c) => c.status === "completed").length}
            </div>
          </CardContent>
        </Card>
      </div>

      <CreateCampaignModal open={modalOpen} onOpenChange={setModalOpen} editData={editingCampaign} />
    </div>
  );
}
